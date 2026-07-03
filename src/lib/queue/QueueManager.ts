import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { bus, updateManager, Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { readLrcFile } from '../lyrics/lrcutils'
import { QueueTrackEntry } from './QueueTrackEntry'
import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'

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

export class QueueManager extends Manager {
    queue: QueueTrackEntry[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement
    #currentWorker: Worker | null = null

    Initialize() {
        this.#initHooks()
        this.#initBusListeners()
    }

    #initBusListeners() {
        bus.on('playback:ended', () => this.PlayNextTrack())
        bus.on('queue:next', () => this.PlayNextTrack())
        bus.on('queue:shuffle', () => this.ShuffleQueue())
    }

    #initHooks() {
        this.#addToQueueInput.addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const files = target.files
            if (!files || files.length < 1) return

            const filesArray = [...files]
            this.ProcessAudioAndLyricsFiles(filesArray)

            this.#addToQueueInput.value = ''
        })

        new MutationObserver(() => {
            const hasItems = this.#queueListElement.children.length > 0
            sqs('#queueContainer .queueEmptyIndicator').toggleAttribute('data-hidden', hasItems)
        }).observe(this.#queueListElement, { childList: true })
    }

    ProcessAudioAndLyricsFiles(files: File[]) {
        if (this.#currentWorker)
            this.#currentWorker.terminate()

        const audioFiles = files.filter(f => {
            if (f.type.startsWith('audio/')) return true
            const ext = '.' + f.name.split('.').pop()!.toLowerCase()
            return ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus'].includes(ext)
        })
        if (audioFiles.length === 0) return

        const entries: { audio: File; lyrics: File | undefined; format: string }[] = []

        for (const audioFile of audioFiles) {
            const match = audioFile.name.toLowerCase().match(/(.*)\.[^.]+$/)
            const lyricsFile = match
                ? files.find(f => f.name.toLowerCase().includes(match[1]) && f.name.toLowerCase().endsWith('.lrc'))
                : undefined

            entries.push({
                audio: audioFile,
                lyrics: lyricsFile,
                format: audioFile.name.split('.').pop() || '',
            })
        }

        const totalFiles = entries.length
        Managers.LoadingBar.Show(totalFiles)
        let processedCount = 0

        const worker = new Worker(
            new URL('../../workers/FileParserWorker.ts', import.meta.url),
            { type: 'module' },
        )
        this.#currentWorker = worker

        worker.postMessage({
            type: 'parse-batch',
            files: entries.map(e => e.audio),
            total: entries.length,
        })

        worker.onmessage = (e: MessageEvent<ParseResult>) => {
            const d = e.data
            this.#processWorkerResult(d, entries, () => {
                processedCount++
                Managers.LoadingBar.Update(processedCount, totalFiles)
                if (processedCount === totalFiles) {
                    Managers.LoadingBar.Hide()
                    this.#currentWorker = null
                    worker.terminate()
                }
            }).catch(err => console.error('Worker result processing failed:', err))
        }

        worker.onerror = (err) => {
            console.error('File parser worker failed:', err)
            Managers.LoadingBar.Hide()
            this.#currentWorker = null
            worker.terminate()
        }
    }

    async #processWorkerResult(
        data: ParseResult,
        entries: { audio: File; lyrics: File | undefined; format: string }[],
        onComplete: () => void,
    ) {
        try {
            const entry = entries[data.index]
            if (!entry) return

            let coverBlobUrl: string | undefined
            if (data.coverBuffer && data.coverFormat) {
                coverBlobUrl = URL.createObjectURL(new Blob([data.coverBuffer], { type: data.coverFormat }))
            }

            const track: Track = {
                audioFile: entry.audio,
                title: data.title,
                artist: data.artist,
                coverImage: coverBlobUrl,
                lyrics: undefined,
                isPlaying: false,
                accentColor: data.accentColor,
                format: data.format,
                coverState: coverBlobUrl ? 'loaded' : 'none',
            }

            this.AddToQueue(track)

            // Update loading bar immediately — don't wait for lyrics
            onComplete()

            // Load lyrics asynchronously
            if (entry.lyrics) {
                const trackEntry = this.queue[this.queue.length - 1]
                if (!trackEntry) return
                try {
                    trackEntry.track.lyrics = await readLrcFile(entry.lyrics)
                    this.#updateQueueItemDOM(trackEntry)
                } catch (err) {
                    console.warn(`Failed to load lyrics for ${data.title}`, err)
                }
            }
        } catch (err) {
            console.warn(`Failed to add track:`, err)
        }
    }
    #updateQueueItemDOM(entry: QueueTrackEntry) {
        const track = entry.track
        const el = track.domElement
        if (!el) return

        const nameEl = el.querySelector('.name') as HTMLElement | null
        const statusEl = el.querySelector('.trackStatus') as HTMLElement | null
        const imgEl = el.querySelector('img') as HTMLImageElement | null

        if (nameEl) nameEl.textContent = track.title
        if (statusEl) {
            statusEl.innerHTML = `
                <span class="format">${track.format}</span>
                <span class="lyrics">${track.lyrics ? 'lyrics loaded' : 'no lyrics'}</span>
            `
            statusEl.setAttribute('data-loaded', String(Boolean(track.lyrics)))
        }
        if (imgEl && track.coverImage) {
            imgEl.src = track.coverImage
            imgEl.classList.remove('loader')
        }
    }

    AddToQueue(track: Track) {
        const trackEntry = new QueueTrackEntry(track, -1)
        const domTrackElement = track.domElement || document.createElement('div')
        domTrackElement.classList.add('queueItem')
        domTrackElement.setAttribute('data-playing', track.isPlaying ? 'true' : 'false')

        const coverHtml = track.coverImage
            ? `<img src="${track.coverImage}" alt="">`
            : ``

        const lyricsHtml = track.lyrics
            ? `<span class="lyrics">lyrics loaded</span>`
            : `<span class="lyrics">loading lyrics</span>`

        domTrackElement.innerHTML = `
            ${coverHtml}
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="trackStatus" data-loaded="${Boolean(track.lyrics)}">
                    <span class="format">${track.format}</span>
                    ${lyricsHtml}
                </p>
            </div>
        `

        domTrackElement.addEventListener('mousedown', event => {
            if (event.button != 2) return
            Managers.ContextMenuManager.PopulateContextMenu(this.#getContextMenuEntries(trackEntry))
            Managers.ContextMenuManager.ShowContextMenu(event.clientX, event.clientY)
        })

        trackEntry.track.domElement = domTrackElement
        trackEntry.order = this.queue.length
        domTrackElement.style.order = `${trackEntry.order}`
        domTrackElement.setAttribute('data-order', `${trackEntry.order}`)

        this.#queueListElement.appendChild(domTrackElement)
        this.queue.push(trackEntry)
    }

    #getContextMenuEntries(trackEntry: QueueTrackEntry): ContextMenuEntry[] {
        return [
            {
                icon: createElement('img', { src: '/assets/icons/keyboard_double_arrow_up.svg' }),
                text: createElement('p', {}, 'Move to top'),
                onClick: _ => {
                    this.SetTrackOrder(trackEntry, this.GetFirstSafeQueueIndex())
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/arrow_upward.svg' }),
                text: createElement('p', {}, 'Move up'),
                onClick: _ => {
                    const firstSafeIndex = this.GetFirstSafeQueueIndex()
                    this.SetTrackOrder(
                        trackEntry,
                        firstSafeIndex > trackEntry.order - 1
                            ? firstSafeIndex
                            : trackEntry.order - 1,
                    )
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/arrow_downward.svg' }),
                text: createElement('p', {}, 'Move down'),
                onClick: _ => {
                    const lastSafeIndex = this.GetLastSafeQueueIndex()
                    this.SetTrackOrder(
                        trackEntry,
                        lastSafeIndex < trackEntry.order + 1
                            ? lastSafeIndex
                            : trackEntry.order + 1,
                    )
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/delete.svg' }),
                text: createElement('p', {}, 'Remove from queue'),
                onClick: _ => {
                    this.RemoveTrackFromQueue(trackEntry)
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/view_image.svg' }),
                text: createElement('p', {}, 'Show cover art'),
                onClick: _ => {
                    if (trackEntry.track.coverImage)
                        window.open(trackEntry.track.coverImage, '_blank')?.focus()
                    else alert("The track doesn't have a cover image.")
                },
            },
        ]
    }

    PlayCurrentTrack() {
        const trackEntry = this.queue[0]
        if (!trackEntry) return

        bus.emit('queue:play-request', { track: trackEntry.track, play: true })
        this.#queueListElement
            .querySelectorAll('.queueItem')[0]
            .setAttribute('data-playing', 'true')
    }

    SetTrackOrder(trackEntry: QueueTrackEntry, order: number) {
        if (order < 0) {
            console.warn('Cannot reorder a track with order less than 0')
            return
        }

        trackEntry.order = order
        this.queue.splice(this.queue.indexOf(trackEntry), 1)
        this.queue.splice(order, 0, trackEntry)

        this.SyncQueueChanges()
    }

    SyncQueueChanges() {
        this.queue.forEach((entry, index) => {
            entry.order = index
            entry.track.domElement?.setAttribute('data-order', `${index}`)
            entry.track.domElement!.style.order = `${index}`
        })
    }

    RemoveTrackElement(element: HTMLElement) {
        const parentBoundingRect = element.parentElement!.getBoundingClientRect()

        element.style.top = `${element.parentElement!.offsetTop - parentBoundingRect.top + element.offsetTop}px`
        element.style.left = `${element.offsetLeft}px`
        element.style.position = 'absolute'
        element.setAttribute('data-removed', 'true')

        updateManager.CreateTimer({
            callback: () => {
                element.remove()
                this.SyncQueueChanges()
            },
            delay: 300,
        })
    }

    RemoveTrackFromQueue(trackEntry: QueueTrackEntry) {
        if (trackEntry.track.coverImage)
            URL.revokeObjectURL(trackEntry.track.coverImage)
        this.queue.splice(this.queue.indexOf(trackEntry), 1)
        this.RemoveTrackElement(trackEntry.track.domElement!)
    }

    GetFirstSafeQueueIndex() {
        return this.queue[0]?.track.isPlaying ? 1 : 0
    }

    GetLastSafeQueueIndex() {
        return this.queue.length
    }

    PlayNextTrack() {
        if (this.queue.length > 0)
            if (this.queue[0].track.isPlaying) {
                const removed = this.queue.shift()
                this.RemoveTrackElement(removed?.track.domElement!)
            }

        if (this.queue.length === 0) return

        const newEntry = this.queue[0]
        newEntry.track.isPlaying = true
        newEntry.track.domElement!.setAttribute('data-playing', 'true')
        bus.emit('queue:play-request', { track: newEntry.track, play: true })
    }

    ShuffleQueue() {
        const safeIndex = this.GetFirstSafeQueueIndex()

        for (let i = this.queue.length - 1; i > safeIndex; i--) {
            const j = Math.floor(Math.random() * (i - safeIndex + 1)) + safeIndex;
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]
        }

        this.SyncQueueChanges()
    }
}
