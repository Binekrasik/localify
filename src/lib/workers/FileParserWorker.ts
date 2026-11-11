import init, { accentFromRgba, parseTrack, planBatch, type ParsedTrack } from '../wasm/localify_core'
import type { FileParserRequest, FileParserResponse } from './FileParserMessages'

const DEFAULT_ACCENT_COLOR = '#7050fd'
const COLOR_SAMPLE_SIZE = 100

const ready = init()

self.onmessage = async (event: MessageEvent<FileParserRequest>) => {
    const request = event.data
    try {
        await ready
    } catch (err) {
        reply({ type: 'failed', message: `Failed to load the parser: ${(err as Error).message}` })
        return
    }

    if (request.type === 'plan') {
        let plan: Int32Array
        try {
            plan = planBatch(request.names, request.types)
        } catch (err) {
            reply({ type: 'failed', message: `Failed to plan the batch: ${(err as Error).message}` })
            return
        }
        reply({ type: 'plan', plan })
        return
    }

    const { track, trapped } = await parse(request.audio, request.lyrics)
    const response: FileParserResponse = { type: 'parsed', index: request.index, track, trapped }
    try {
        reply(response, track.cover ? [track.cover.buffer as ArrayBuffer] : [])
    } catch {
        // A buffer that can't be transferred is copied instead.
        reply(response)
    }
}

function reply(response: FileParserResponse, transfer: Transferable[] = []) {
    self.postMessage(response, { transfer })
}

async function parse(audio: File, lyrics: File | null): Promise<{ track: ParsedTrack; trapped: boolean }> {
    let track: ParsedTrack
    try {
        track = parseTrack(audio, lyrics)
    } catch (err) {
        // parseTrack reports unreadable files in its result. It throws only when the wasm instance traps.
        return { track: fallbackTrack(audio, err), trapped: true }
    }
    if (track.coverUndecoded && track.cover && track.coverFormat)
        track.accentColor = await accentFromCover(track.cover, track.coverFormat)
    return { track, trapped: false }
}

/** A track built from the file name alone, for when the parser traps. */
function fallbackTrack(audio: File, err: unknown): ParsedTrack {
    const extension = audio.name.match(/\.([^.]+)$/)
    return {
        title: audio.name.replace(/\.[^.]+$/, ''),
        artist: 'Unknown Artist',
        album: '',
        format: extension ? extension[1].toLowerCase() : '',
        accentColor: DEFAULT_ACCENT_COLOR,
        cover: null,
        coverFormat: null,
        coverUndecoded: false,
        lyrics: null,
        error: err instanceof Error ? err.message : String(err),
    }
}

/** Decodes a cover the parser has no decoder for and picks its accent from a copy at most 100x100 in size. */
async function accentFromCover(cover: Uint8Array, format: string): Promise<string> {
    try {
        const bitmap = await createImageBitmap(new Blob([cover as BlobPart], { type: format }))
        const width = Math.min(bitmap.width, COLOR_SAMPLE_SIZE)
        const height = Math.min(bitmap.height, COLOR_SAMPLE_SIZE)
        const context = new OffscreenCanvas(width, height).getContext('2d')!
        context.drawImage(bitmap, 0, 0, width, height)
        bitmap.close()
        const { data } = context.getImageData(0, 0, width, height)
        return accentFromRgba(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height)
    } catch {
        return DEFAULT_ACCENT_COLOR
    }
}
