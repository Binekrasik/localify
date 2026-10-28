import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { bus, Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { readLrcFile } from '../lyrics/lrcutils'
import { QueueTrackEntry } from './QueueTrackEntry'
import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'
import { QueueInteraction } from './QueueInteraction'
import { queueMotion, reducedQueueMotion } from './QueueMotion'

interface ParseResult {
    type: 'parse-result'
    index: number
    total: number
    title: string
    artist: string
    album: string
    coverBuffer: ArrayBuffer | null
    coverFormat: string | null
    accentColor: string
    format: string
    error?: string
}

export class QueueManager extends Manager {
    queue: QueueTrackEntry[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #interaction = new QueueInteraction(this.#queueListElement, this)
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement
    #currentWorker: Worker | null = null
    #rowMoves = new Map<HTMLElement, Animation>()
    #rowRemovals = new Set<Animation>()

    Initialize() {
        this.#initHooks()
        this.#initBusListeners()
        this.#interaction.Initialize()
        reducedQueueMotion.addEventListener('change', () => {
            if (!reducedQueueMotion.matches) return
            for (const animation of this.#rowMoves.values()) animation.finish()
            for (const animation of this.#rowRemovals) animation.finish()
        })
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
            const hasItems = this.#queueListElement.querySelector('.queueItem') !== null
            sqs('#queueContainer .queueEmptyIndicator').setAttribute('data-hidden', String(hasItems))
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
        Managers.LoadingBarManager.Show(totalFiles)
        let processedCount = 0

        const worker = new Worker(
            new URL('../workers/FileParserWorker.ts', import.meta.url),
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
                Managers.LoadingBarManager.Update(processedCount, totalFiles)
                if (processedCount === totalFiles) {
                    Managers.LoadingBarManager.Hide()
                    this.#currentWorker = null
                    worker.terminate()
                }
            }).catch(err => console.error('Worker result processing failed:', err))
        }

        worker.onerror = (err) => {
            console.error('File parser worker failed:', err)
            Managers.LoadingBarManager.Hide()
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
                album: data.album || undefined,
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

        const nameElem = el.querySelector('.nameText') as HTMLElement | null
        const statusElem = el.querySelector('.trackInfo') as HTMLElement | null
        const imgElem = el.querySelector('img') as HTMLImageElement | null

        if (nameElem) nameElem.textContent = track.title
        if (statusElem)
            statusElem.setAttribute('data-loaded', String(Boolean(track.lyrics)))

        if (imgElem && track.coverImage) {
            imgElem.src = track.coverImage
            imgElem.classList.remove('loader')
        }
    }

    AddToQueue(track: Track) {
        track.isPlaying = false
        const trackEntry = new QueueTrackEntry(track, -1)
        const domTrackElement = track.domElement || document.createElement('div')
        domTrackElement.classList.add('queueItem')
        domTrackElement.setAttribute('data-playing', track.isPlaying ? 'true' : 'false')
        domTrackElement.setAttribute('role', 'option')
        domTrackElement.setAttribute('aria-selected', 'false')

        const coverHtml = track.coverImage
            ? `<img src="${track.coverImage}" alt="">`
            : ``

        domTrackElement.innerHTML = `
            ${coverHtml}
            <div class="trackInfo">
                <div class="trackHeader">
                    <p class="name"><span class="nameText">${track.title}</span></p>
                    <span class="queuePinIndicator" role="img" aria-label="Pinned" title="Pinned"></span>
                </div>
                <p class="trackDetails" data-loaded="${Boolean(track.lyrics)}">
                    <span class="format">${track.format}</span>
                    <span class="artist">${track.artist}</span>
                </p>
            </div>
        `

        domTrackElement.addEventListener('mousedown', event => {
            if (event.button != 2) return
            if (!this.queue.includes(trackEntry)) return
            this.#interaction.SelectForContextMenu(trackEntry)
            Managers.ContextMenuManager.PopulateContextMenu(this.#getContextMenuEntries(this.#interaction.SelectedEntries))
            Managers.ContextMenuManager.ShowContextMenu(event.clientX, event.clientY)
        })

        trackEntry.track.domElement = domTrackElement
        trackEntry.order = this.queue.length
        domTrackElement.style.order = `${trackEntry.order}`
        domTrackElement.setAttribute('data-order', `${trackEntry.order}`)

        this.#queueListElement.appendChild(domTrackElement)
        this.queue.push(trackEntry)
        this.#interaction.TrackAdded()
    }

    #getContextMenuEntries(trackEntries: QueueTrackEntry[]): ContextMenuEntry[] {
        const allPinned = trackEntries.every(entry => entry.isPinned)
        return [
            {
                icon: createElement('img', { src: '/assets/icons/keyboard_double_arrow_up.svg' }),
                text: createElement('p', {}, 'Move to top'),
                onClick: _ => {
                    this.SetTracksOrder(trackEntries, this.GetFirstSafeQueueIndex())
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/arrow_upward.svg' }),
                text: createElement('p', {}, 'Move up'),
                onClick: _ => {
                    this.#moveTracksByOne(trackEntries, -1)
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/arrow_downward.svg' }),
                text: createElement('p', {}, 'Move down'),
                onClick: _ => {
                    this.#moveTracksByOne(trackEntries, 1)
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/push_pin.svg' }),
                text: createElement('p', {}, allPinned ? 'Unpin track' : 'Pin track'),
                onClick: _ => {
                    for (const entry of trackEntries) {
                        if (!this.queue.includes(entry)) continue
                        entry.isPinned = !allPinned
                        entry.track.domElement?.setAttribute('data-pinned', String(entry.isPinned))
                    }
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/delete.svg' }),
                text: createElement('p', {}, 'Remove from queue'),
                onClick: _ => {
                    this.RemoveTracksFromQueue(trackEntries)
                },
            },
            {
                icon: createElement('img', { src: '/assets/icons/view_image.svg' }),
                text: createElement('p', {}, 'Show cover art'),
                onClick: _ => {
                    this.#showCoverArt(trackEntries)
                },
            },
        ]
    }

    #showCoverArt(entries: QueueTrackEntry[]) {
        if (entries.length === 1) {
            if (entries[0].track.coverImage) window.open(entries[0].track.coverImage, '_blank')?.focus()
            else alert("The track doesn't have a cover image.")
            return
        }
        const gallery = window.open('', '_blank')
        if (!gallery) return
        gallery.opener = null
        gallery.document.title = 'Queue cover art'
        const style = gallery.document.createElement('style')
        style.textContent = `
            body { margin: 2rem; background: #111; color: #eee; font-family: system-ui, sans-serif;
                display: flex; flex-wrap: wrap; gap: 2rem; }
            figure { margin: 0; max-width: 420px; }
            img { display: block; max-width: 100%; max-height: 70vh; }
            figcaption { margin-top: 0.75rem; }
            @media (prefers-reduced-motion: no-preference) {
                figure { animation: coverIn 0.4s cubic-bezier(0.63, 0.234, 0, 1); }
                @keyframes coverIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            }
        `
        gallery.document.head.appendChild(style)
        for (const entry of entries) {
            const figure = gallery.document.createElement('figure')
            if (entry.track.coverImage) {
                const image = gallery.document.createElement('img')
                image.src = entry.track.coverImage
                image.alt = entry.track.title
                figure.appendChild(image)
            } else {
                const missing = gallery.document.createElement('p')
                missing.textContent = 'No cover image'
                figure.appendChild(missing)
            }
            const caption = gallery.document.createElement('figcaption')
            caption.textContent = `${entry.track.title} · ${entry.track.artist}`
            figure.appendChild(caption)
            gallery.document.body.appendChild(figure)
        }
        gallery.focus()
    }

    PlayCurrentTrack() {
        const trackEntry = this.queue[0]
        if (!trackEntry) return

        this.#setPlayingTrack(trackEntry)
        bus.emit('queue:play-request', { track: trackEntry.track, play: true })
    }

    #setPlayingTrack(playingEntry?: QueueTrackEntry) {
        this.#interaction.CancelGesture()
        for (const entry of this.queue) {
            entry.track.isPlaying = entry === playingEntry
            entry.track.domElement?.setAttribute('data-playing', String(entry.track.isPlaying))
        }
    }

    SetTrackOrder(trackEntry: QueueTrackEntry, order: number) {
        this.SetTracksOrder([trackEntry], order)
    }

    SetTracksOrder(trackEntries: readonly QueueTrackEntry[], order: number) {
        if (!Number.isFinite(order)) return
        const requested = new Set(trackEntries)
        const safeIndex = this.GetFirstSafeQueueIndex()
        const moving = this.queue.filter((entry, index) => index >= safeIndex && requested.has(entry))
        if (!moving.length) return
        const movingSet = new Set(moving)
        const remaining = this.queue.filter(entry => !movingSet.has(entry))
        const insertionIndex = Math.max(safeIndex, Math.min(Math.trunc(order), remaining.length))
        remaining.splice(insertionIndex, 0, ...moving)
        this.queue = remaining
        this.SyncQueueChanges()
    }

    MoveTracksBefore(trackEntries: readonly QueueTrackEntry[], beforeEntry: QueueTrackEntry | null) {
        const moving = new Set(trackEntries)
        const remaining = this.queue.filter((entry, index) => index < this.GetFirstSafeQueueIndex() || !moving.has(entry))
        if (beforeEntry && !remaining.includes(beforeEntry)) return
        this.SetTracksOrder(trackEntries, beforeEntry ? remaining.indexOf(beforeEntry) : remaining.length)
    }

    #moveTracksByOne(trackEntries: readonly QueueTrackEntry[], direction: -1 | 1) {
        const selected = new Set(trackEntries)
        const safeIndex = this.GetFirstSafeQueueIndex()
        const start = direction === -1 ? safeIndex : this.queue.length - 1
        for (let index = start; index >= safeIndex && index < this.queue.length; index -= direction) {
            const neighbour = index + direction
            if (neighbour < safeIndex || neighbour >= this.queue.length) continue
            if (selected.has(this.queue[index]) && !selected.has(this.queue[neighbour]))
                [this.queue[index], this.queue[neighbour]] = [this.queue[neighbour], this.queue[index]]
        }
        this.SyncQueueChanges()
    }

    #getRowPositions() {
        const positions = new Map<HTMLElement, DOMRect>()
        for (const entry of this.queue) {
            const element = entry.track.domElement
            if (element) positions.set(element, element.getBoundingClientRect())
        }
        return positions
    }

    SyncQueueChanges(previousPositions = this.#getRowPositions()) {
        for (const animation of this.#rowMoves.values()) animation.cancel()
        this.#rowMoves.clear()
        this.queue.forEach((entry, index) => {
            entry.order = index
            entry.track.domElement?.setAttribute('data-order', `${index}`)
            entry.track.domElement!.style.order = `${index}`
        })
        if (!reducedQueueMotion.matches) {
            const positions = this.#getRowPositions()
            for (const [element, position] of positions) {
                const previous = previousPositions.get(element)
                if (!previous) continue
                const offset = previous.top - position.top
                if (Math.abs(offset) < 0.5) continue
                const animation = element.animate([
                    { translate: `0 ${offset}px` },
                    { translate: '0 0' },
                ], queueMotion)
                this.#rowMoves.set(element, animation)
                animation.onfinish = () => {
                    if (this.#rowMoves.get(element) === animation) this.#rowMoves.delete(element)
                }
            }
        }
        this.#interaction.QueueChanged()
    }

    RemoveTrackFromQueue(trackEntry: QueueTrackEntry) {
        this.RemoveTracksFromQueue([trackEntry])
    }

    RemoveTracksFromQueue(trackEntries: readonly QueueTrackEntry[]) {
        const requested = new Set(trackEntries)
        const removing = this.queue.filter(entry => requested.has(entry))
        if (!removing.length) return
        const positions = this.#getRowPositions()
        const bounds = this.#queueListElement.getBoundingClientRect()
        const removingPlayingTrack = removing.some(entry => entry.track.isPlaying)
        if (removingPlayingTrack) this.#setPlayingTrack()

        this.queue = this.queue.filter(entry => !requested.has(entry))
        for (const entry of removing) {
            if (entry.track.coverImage) URL.revokeObjectURL(entry.track.coverImage)
            const element = entry.track.domElement
            if (!element) continue
            const position = positions.get(element)!
            if (reducedQueueMotion.matches) {
                element.remove()
                continue
            }
            const opacity = getComputedStyle(element).opacity
            element.style.animation = 'none'
            Object.assign(element.style, {
                position: 'absolute',
                top: `${position.top - bounds.top + this.#queueListElement.scrollTop}px`,
                left: `${position.left - bounds.left + this.#queueListElement.scrollLeft}px`,
                width: `${position.width}px`,
                height: `${position.height}px`,
            })
            element.setAttribute('data-removed', 'true')
            const animation = element.animate([
                { opacity, transform: 'translateX(0)' },
                { opacity: 0, transform: `translateX(${bounds.width}px)` },
            ], { ...queueMotion, fill: 'forwards' })
            this.#rowRemovals.add(animation)
            animation.onfinish = () => {
                element.remove()
                animation.cancel()
                this.#rowRemovals.delete(animation)
            }
        }
        this.SyncQueueChanges(positions)

        if (removingPlayingTrack) {
            if (this.queue.length) this.PlayCurrentTrack()
            else Managers.PlayerManager.SkipCurrentTrack()
        }
    }

    GetFirstSafeQueueIndex() {
        return this.queue[0]?.track.isPlaying ? 1 : 0
    }

    GetLastSafeQueueIndex() {
        return this.queue.length
    }

    PlayNextTrack() {
        const currentEntry = this.queue[0]
        if (currentEntry?.track.isPlaying) this.RemoveTrackFromQueue(currentEntry)
        else this.PlayCurrentTrack()
    }

    ShuffleQueue() {
        const safeIndex = this.GetFirstSafeQueueIndex()
        const unpinnedIndices = this.queue.flatMap((entry, index) => index >= safeIndex && !entry.isPinned ? [index] : [])
        for (let i = unpinnedIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            const from = unpinnedIndices[i]
            const to = unpinnedIndices[j];
            [this.queue[from], this.queue[to]] = [this.queue[to], this.queue[from]]
        }

        this.SyncQueueChanges()
    }
}
