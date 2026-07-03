import { parseBlob } from 'music-metadata'

interface ManualMetadata {
    title: string
    artist: string
    accentColor: string
    picture: { data: Uint8Array; format: string } | null
}

const MIME_MAP: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    opus: 'audio/ogg',
}

function normalizeBlob(file: File): Blob {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const mapped = MIME_MAP[ext]
    if (mapped && mapped !== file.type)
        return new Blob([file], { type: mapped })
    return file
}

interface ParseResult {
    type: 'parse-result'
    index: number
    total: number
    title: string
    artist: string
    coverBuffer: ArrayBuffer | null
    coverFormat: string | null
    accentColor: string
    format: string
    error?: string
}

const CONCURRENCY = 3
const DEFAULT_ACCENT_COLOR = '#7050fd'

// ── Manual OGG/Opus cover extraction ──────────────────────
// music-metadata's OpusStream.parseFullPage() only processes the first
// OGG page with OpusTags magic. When large cover art base64 spans
// multiple pages, continuation pages are silently dropped.

function parseVorbisComments(data: Uint8Array): { title: string; artist: string; picture: { data: Uint8Array; format: string } | null } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let off = 0

    if (off + 4 > data.byteLength) return { title: '', artist: '', picture: null }
    const vendorLen = view.getUint32(off, true)
    off += 4 + vendorLen

    if (off + 4 > data.byteLength) return { title: '', artist: '', picture: null }
    const numComments = view.getUint32(off, true)
    off += 4

    let title = ''
    let artist = ''
    let picture: { data: Uint8Array; format: string } | null = null

    for (let i = 0; i < numComments; i++) {
        if (off + 4 > data.byteLength) break
        const commentLen = view.getUint32(off, true)
        off += 4
        if (off + commentLen > data.byteLength) break
        const commentStr = new TextDecoder().decode(data.subarray(off, off + commentLen))
        off += commentLen
        if (commentStr.startsWith('TITLE=')) {
            title = commentStr.slice(6)
        } else if (commentStr.startsWith('ARTIST=')) {
            artist = commentStr.slice(7)
        } else if (commentStr.startsWith('METADATA_BLOCK_PICTURE=') && !picture) {
            const b64 = commentStr.slice(23).replace(/[^A-Za-z0-9+/=]/g, '')
            let raw: Uint8Array
            try {
                raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
            } catch {
                continue
            }
            if (raw.length < 12) continue
            const picView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
            let pOff = 4
            const mimeLen = picView.getUint32(pOff, false)
            pOff += 4
            if (pOff + mimeLen > raw.length) continue
            const format = new TextDecoder().decode(raw.subarray(pOff, pOff + mimeLen))
            pOff += mimeLen
            if (pOff + 4 > raw.length) continue
            const descLen = picView.getUint32(pOff, false)
            pOff += 4 + descLen
            if (pOff + 16 + 4 > raw.length) continue
            pOff += 16
            const picDataLen = picView.getUint32(pOff, false)
            pOff += 4
            if (pOff + picDataLen > raw.length) continue
            const imgData = raw.subarray(pOff, pOff + picDataLen)
            picture = { data: new Uint8Array(imgData), format: format.toLocaleLowerCase() }
        }
    }

    return { title, artist, picture }
}

async function extractVibrantColor(imgData: Uint8Array, format: string): Promise<string> {
    try {
        const blob = new Blob([new Uint8Array(imgData)], { type: format })
        const bitmap = await createImageBitmap(blob)
        const sw = Math.min(bitmap.width, 100)
        const sh = Math.min(bitmap.height, 100)
        const canvas = new OffscreenCanvas(sw, sh)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0, sw, sh)
        const pixels = ctx.getImageData(0, 0, sw, sh).data
        bitmap.close()

        let maxSat = -1
        let vibrantColor = DEFAULT_ACCENT_COLOR
        for (let i = 0; i < pixels.length; i += 16) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
            const sat = Math.max(r, g, b) - Math.min(r, g, b)
            if (sat > maxSat) {
                maxSat = sat
                vibrantColor = '#' +
                    r.toString(16).padStart(2, '0') +
                    g.toString(16).padStart(2, '0') +
                    b.toString(16).padStart(2, '0')
            }
        }
        return vibrantColor
    } catch {
        return DEFAULT_ACCENT_COLOR
    }
}

/** Manually extract metadata from an Opus file by parsing OGG pages
 *  and Vorbis comments directly. Returns null if no metadata found. */
async function parseOpusMetadata(buf: ArrayBuffer): Promise<ManualMetadata | null> {
    const u8 = new Uint8Array(buf)
    const bufLen = buf.byteLength
    let off = 0

    while (off + 27 <= bufLen) {
        if (u8[off] !== 0x4F || u8[off + 1] !== 0x67 || u8[off + 2] !== 0x67 || u8[off + 3] !== 0x53) {
            off++
            continue
        }

        const hdrType = u8[off + 5]
        const nSegs = u8[off + 26]
        const segTab = u8.subarray(off + 27, off + 27 + nSegs)
        let pdSize = 0
        for (let i = 0; i < nSegs; i++) pdSize += segTab[i]
        const pdOff = off + 27 + nSegs
        const pdEnd = pdOff + pdSize

        // Determine where OpusTags starts in this page
        let opusTagsOff = -1

        if (pdSize >= 8) {
            for (let i = 0; i <= pdSize - 8; i++) {
                const m0 = (u8[pdOff+i] << 24) | (u8[pdOff+i+1] << 16) | (u8[pdOff+i+2] << 8) | u8[pdOff+i+3]
                const m1 = (u8[pdOff+i+4] << 24) | (u8[pdOff+i+5] << 16) | (u8[pdOff+i+6] << 8) | u8[pdOff+i+7]
                if (m0 === 0x4F707573 && m1 === 0x54616773) {
                    opusTagsOff = i
                    break
                }
            }
        }

        if (opusTagsOff >= 0 && (hdrType & 0x01)) {
            // OpusTags is on a continued page — this shouldn't normally happen
            // (the first page of OpusTags should start fresh)
        }
        if (opusTagsOff >= 0 && !(hdrType & 0x01)) {
            const chunks: Uint8Array[] = []
            let reading = true
            let curOff = off
            let skipBefore = opusTagsOff + 8 // offset of "OpusTags" magic + 8 bytes for the tag itself

            while (reading && curOff + 27 <= bufLen) {
                if (u8[curOff] !== 0x4F || u8[curOff+1] !== 0x67 || u8[curOff+2] !== 0x67 || u8[curOff+3] !== 0x53)
                    break
                const curNSegs = u8[curOff + 26]
                const curSegTab = u8.subarray(curOff + 27, curOff + 27 + curNSegs)
                let curPdSize = 0
                for (let i = 0; i < curNSegs; i++) curPdSize += curSegTab[i]
                const curPdOff = curOff + 27 + curNSegs
                const curPdEnd = curPdOff + curPdSize
                let dataOff = curPdOff

                for (let i = 0; i < curNSegs; i++) {
                    const sz = curSegTab[i]
                    const end = Math.min(dataOff + sz, bufLen)
                    let start = dataOff
                    if (curOff === off && skipBefore > 0) {
                        const skipAmt = Math.min(sz, skipBefore)
                        start += skipAmt
                        skipBefore -= skipAmt
                    }
                    if (end > start)
                        chunks.push(u8.subarray(start, end))
                    dataOff = end
                    if (sz < 255) {
                        reading = false
                        break
                    }
                }
                curOff = curPdEnd
            }

            if (chunks.length > 0) {
                const totalSz = chunks.reduce((a, c) => a + c.byteLength, 0)
                const full = new Uint8Array(totalSz)
                let pos = 0
                for (const c of chunks) { full.set(c, pos); pos += c.byteLength }

                try {
                    const vorbis = parseVorbisComments(full)
                    const accentColor = vorbis.picture 
                        ? await extractVibrantColor(vorbis.picture.data, vorbis.picture.format)
                        : DEFAULT_ACCENT_COLOR
                    return {
                        title: vorbis.title || '',
                        artist: vorbis.artist || '',
                        accentColor,
                        picture: vorbis.picture,
                    }
                } catch {
                    // no metadata
                }
            }
        }

        off = pdEnd
        if (off >= bufLen) break
    }
    return null
}

// ── End manual parser ─────────────────────────────────────

self.onmessage = async (e: MessageEvent<{ type: 'parse-batch'; files: File[]; total: number }>) => {
    const { files, total } = e.data
    let nextIndex = 0

    async function processNext() {
        while (nextIndex < files.length) {
            const index = nextIndex++
            const result = await parseFile(files[index], index, total)
            const transferables = result.coverBuffer ? [result.coverBuffer] : []
            ;(self as any).postMessage(result, transferables)
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => processNext()))
}

async function parseFile(file: File, index: number, total: number): Promise<ParseResult> {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (ext === 'opus') {
        return parseOpusFile(file, index, total, ext)
    }
    return parseNonOpusFile(file, index, total, ext)
}

async function parseOpusFile(file: File, index: number, total: number, ext: string): Promise<ParseResult> {
    try {
        const buf = await file.arrayBuffer()
        const manual = await parseOpusMetadata(buf)
        if (manual) {
            let coverBuffer: ArrayBuffer | null = null
            let coverFormat: string | null = null
            if (manual.picture) {
                const copy = new Uint8Array(manual.picture.data)
                coverBuffer = copy.buffer as ArrayBuffer
                coverFormat = manual.picture.format
            }
            return {
                type: 'parse-result',
                index, total,
                title: manual.title || file.name.replace(/\.[^.]+$/, ''),
                artist: manual.artist || 'Unknown Artist',
                coverBuffer,
                coverFormat,
                accentColor: manual.accentColor,
                format: ext,
            }
        }
        // Manual parser returned null — fall back to music-metadata with existing buffer
        const blob = new Blob([buf], { type: 'audio/ogg' })
        const metadata = await parseBlob(blob)
        const pic = metadata.common.picture?.[0]
        let coverBuffer: ArrayBuffer | null = null
        let coverFormat: string | null = null
        if (pic?.data) {
            const copy = new Uint8Array(pic.data)
            coverBuffer = copy.buffer as ArrayBuffer
            coverFormat = pic.format
        }
        return {
            type: 'parse-result',
            index, total,
            title: metadata.common.title || file.name.replace(/\.[^.]+$/, ''),
            artist: metadata.common.artist || 'Unknown Artist',
            coverBuffer, coverFormat,
            accentColor: DEFAULT_ACCENT_COLOR,
            format: ext,
        }
    } catch (err) {
        return {
            type: 'parse-result',
            index, total,
            title: file.name.replace(/\.[^.]+$/, ''),
            artist: 'Unknown Artist',
            coverBuffer: null, coverFormat: null,
            accentColor: DEFAULT_ACCENT_COLOR,
            format: ext,
            error: (err as Error).message,
        }
    }
}

async function parseNonOpusFile(file: File, index: number, total: number, ext: string): Promise<ParseResult> {
    try {
        const blob = normalizeBlob(file)
        const metadata = await parseBlob(blob)
        const pic = metadata.common.picture?.[0]
        let coverBuffer: ArrayBuffer | null = null
        let coverFormat: string | null = null
        if (pic?.data) {
            const copy = new Uint8Array(pic.data)
            coverBuffer = copy.buffer as ArrayBuffer
            coverFormat = pic.format
        }
        return {
            type: 'parse-result',
            index, total,
            title: metadata.common.title || file.name.replace(/\.[^.]+$/, ''),
            artist: metadata.common.artist || 'Unknown Artist',
            coverBuffer, coverFormat,
            accentColor: DEFAULT_ACCENT_COLOR,
            format: ext,
        }
    } catch (err) {
        return {
            type: 'parse-result',
            index, total,
            title: file.name.replace(/\.[^.]+$/, ''),
            artist: 'Unknown Artist',
            coverBuffer: null, coverFormat: null,
            accentColor: DEFAULT_ACCENT_COLOR,
            format: ext,
            error: (err as Error).message,
        }
    }
}
