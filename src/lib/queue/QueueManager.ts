import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { bus, Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { readLrcFile } from '../lyrics/lrcutils'
import { QueueTrackEntry } from './QueueTrackEntry'
import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'
import { QueueInteraction } from './QueueInteraction'
import { queueMotion } from './QueueMotion'
import { reducedMotion } from '../motion'
import { initQueueCollapse } from './QueueCollapse'
import { PlayPauseIcon } from '../player/PlayPauseIcon'

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

function createListDecoration(className: string) {
    const element = document.createElement('div')
    element.className = className
    element.setAttribute('role', 'presentation')
    return element
}

export class QueueManager extends Manager {
    /** Every row in display order: played tracks, then the current track, then upcoming tracks. */
    queue: QueueTrackEntry[] = []
    #historyLength = 0
    #queueListElement = sqs('#queue') as HTMLDivElement
    #historyDivider = createListDecoration('queueHistoryDivider')
    #scrollSpacer = createListDecoration('queueScrollSpacer')
    #interaction = new QueueInteraction(this.#queueListElement, this)
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement
    #currentWorker: Worker | null = null
    #rowMoves = new Map<HTMLElement, Animation>()
    #rowRemovals = new Set<Animation>()
    #playIcons = new WeakMap<QueueTrackEntry, PlayPauseIcon>()
    /**
     * Keeps `data-near-viewport` on the rows within two list heights of the visible area, which always render.
     * Chromium renders `content-visibility: auto` rows within 1.5 heights, so a wider margin makes each row
     * start rendering once, when it gains the attribute.
     */
    #nearRows = new IntersectionObserver(entries => {
        for (const entry of entries) entry.target.toggleAttribute('data-near-viewport', entry.isIntersecting)
    }, { root: this.#queueListElement, rootMargin: '200% 0px' })

    Initialize() {
        this.#initHooks()
        this.#initBusListeners()
        this.#interaction.Initialize()
        initQueueCollapse()
        this.#queueListElement.appendChild(this.#scrollSpacer)
        new ResizeObserver(() => this.#syncScrollRoom()).observe(this.#queueListElement)
        reducedMotion.addEventListener('change', () => {
            if (!reducedMotion.matches) return
            for (const animation of this.#rowMoves.values()) animation.finish()
            for (const animation of this.#rowRemovals) animation.finish()
        })
    }

    #initBusListeners() {
        bus.on('playback:ended', () => this.PlayNextTrack())
        bus.on('queue:next', () => this.PlayNextTrack())
        bus.on('queue:previous', () => this.PlayPreviousTrack())
        bus.on('playback:play', () => this.#syncPlayButtons())
        bus.on('playback:pause', () => this.#syncPlayButtons())
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

        sqs('#queueFooter label[data-type="file"]').addEventListener('keydown', event => {
            const { key, repeat } = event as KeyboardEvent
            if (key !== 'Enter' && key !== ' ') return
            event.preventDefault()
            if (!repeat) this.#addToQueueInput.click()
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
                    <span class="artist">${track.artist}</span>
                </p>
            </div>
            <button class="queuePlayButton" type="button" tabindex="-1" aria-label="Play track" title="Play"></button>
        `

        const playButton = domTrackElement.querySelector('.queuePlayButton') as HTMLButtonElement
        const playIcon = new PlayPauseIcon()
        playButton.append(playIcon.element)
        this.#playIcons.set(trackEntry, playIcon)
        // The list owns keyboard focus, so a click must not move it onto the button.
        playButton.addEventListener('mousedown', event => event.preventDefault())
        playButton.addEventListener('click', () => this.PlayOrToggleEntry(trackEntry))

        domTrackElement.addEventListener('mousedown', event => {
            if (event.button != 2) return
            if (!this.queue.includes(trackEntry)) return
            this.#interaction.SelectForContextMenu(trackEntry)
            Managers.ContextMenuManager.PopulateContextMenu(this.#getContextMenuEntries(this.#interaction.SelectedEntries))
            Managers.ContextMenuManager.ShowContextMenu(event.clientX, event.clientY)
        })

        trackEntry.track.domElement = domTrackElement
        this.#placeRow(trackEntry, this.queue.length)

        this.#queueListElement.appendChild(domTrackElement)
        this.#reserveRowHeight(domTrackElement)
        this.#nearRows.observe(domTrackElement)
        this.queue.push(trackEntry)
        this.#syncScrollRoom()
        this.#interaction.TrackAdded()
    }

    /**
     * Rows away from the viewport skip rendering. Until a row has been shown its content takes up the
     * height measured here, so rows that were never on screen sit exactly where they will be drawn.
     */
    #reserveRowHeight(row: HTMLElement) {
        row.style.setProperty('content-visibility', 'visible')
        const style = getComputedStyle(row)
        const contentHeight = row.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        row.style.setProperty('contain-intrinsic-block-size', `auto ${contentHeight}px`)
        row.style.removeProperty('content-visibility')
    }

    #getContextMenuEntries(trackEntries: QueueTrackEntry[]): ContextMenuEntry[] {
        const allPinned = trackEntries.every(entry => entry.isPinned)
        return [
            {
                icon: createElement('img', { src: '/assets/icons/keyboard_double_arrow_up.svg' }),
                text: createElement('p', {}, 'Move to top'),
                onClick: _ => {
                    this.#moveTracksToTop(trackEntries)
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
        const trackEntry = this.queue[this.#historyLength]
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
        this.#syncPlayButtons()
    }

    #syncPlayButtons() {
        for (const entry of this.queue) {
            const button = entry.track.domElement?.querySelector('.queuePlayButton')
            if (!button) continue
            const canPause = entry.track.isPlaying && Managers.PlayerManager.isPlaying
            this.#playIcons.get(entry)?.Set(canPause)
            button.setAttribute('aria-label', canPause ? 'Pause track' : 'Play track')
            button.setAttribute('title', canPause ? 'Pause' : 'Play')
        }
    }

    /** Reorders the played and upcoming rows; the current track stays between them. */
    #rearrange(arrange: (history: QueueTrackEntry[], upcoming: QueueTrackEntry[]) => void) {
        const safeIndex = this.GetFirstSafeQueueIndex()
        const history = this.queue.slice(0, this.#historyLength)
        const current = this.queue.slice(this.#historyLength, safeIndex)
        const upcoming = this.queue.slice(safeIndex)
        arrange(history, upcoming)
        this.queue = [...history, ...current, ...upcoming]
        this.#historyLength = history.length
        this.SyncQueueChanges()
    }

    /** Moves each track to the top of its own section, history or upcoming. */
    #moveTracksToTop(trackEntries: readonly QueueTrackEntry[]) {
        const selected = new Set(trackEntries)
        this.#rearrange((history, upcoming) => {
            for (const section of [history, upcoming]) {
                const moving = section.filter(entry => selected.has(entry))
                const remaining = section.filter(entry => !selected.has(entry))
                section.splice(0, section.length, ...moving, ...remaining)
            }
        })
    }

    MoveTracksBefore(trackEntries: readonly QueueTrackEntry[], beforeEntry: QueueTrackEntry | null, intoHistory: boolean) {
        const requested = new Set(trackEntries)
        this.#rearrange((history, upcoming) => {
            const moving = [...history, ...upcoming].filter(entry => requested.has(entry))
            for (const section of [history, upcoming])
                section.splice(0, section.length, ...section.filter(entry => !requested.has(entry)))
            const target = intoHistory ? history : upcoming
            const index = beforeEntry ? target.indexOf(beforeEntry) : target.length
            target.splice(index === -1 ? target.length : index, 0, ...moving)
        })
    }

    #moveTracksByOne(trackEntries: readonly QueueTrackEntry[], direction: -1 | 1) {
        const selected = new Set(trackEntries)
        this.#rearrange((history, upcoming) => {
            for (const section of [history, upcoming]) {
                const start = direction === -1 ? 0 : section.length - 1
                for (let index = start; index >= 0 && index < section.length; index -= direction) {
                    const neighbour = index + direction
                    if (neighbour < 0 || neighbour >= section.length) continue
                    if (selected.has(section[index]) && !selected.has(section[neighbour]))
                        [section[index], section[neighbour]] = [section[neighbour], section[index]]
                }
            }
        })
    }

    #getRowPositions() {
        const positions = new Map<HTMLElement, DOMRect>()
        for (const entry of this.queue) {
            const element = entry.track.domElement
            if (element) positions.set(element, element.getBoundingClientRect())
        }
        if (this.#historyDivider.isConnected)
            positions.set(this.#historyDivider, this.#historyDivider.getBoundingClientRect())
        return positions
    }

    /** Assigns a row its place in the list, leaving a slot for the history divider. */
    #placeRow(entry: QueueTrackEntry, index: number) {
        const element = entry.track.domElement!
        entry.order = index
        element.setAttribute('data-order', `${index}`)
        element.setAttribute('data-history', String(index < this.#historyLength))
        element.style.order = `${index < this.#historyLength ? index : index + 1}`
    }

    #syncHistoryDivider() {
        const divider = this.#historyDivider
        divider.style.order = `${this.#historyLength}`
        const visible = this.#historyLength > 0
        if (visible === divider.isConnected) return
        if (!visible) {
            divider.remove()
            return
        }
        this.#queueListElement.appendChild(divider)
        if (!reducedMotion.matches) divider.animate([{ opacity: 0 }, { opacity: 1 }], queueMotion)
    }

    /** The scroll offset that puts the current row where the first row sits in an unscrolled list. */
    #currentRowScrollTop() {
        const row = this.queue[this.#historyLength]?.track.domElement
        if (!row) return undefined
        return row.offsetTop - parseFloat(getComputedStyle(this.#queueListElement).paddingTop)
    }

    /** Sizes the spacer so the list can scroll the current row to the top even with few rows below it. */
    #syncScrollRoom() {
        const list = this.#queueListElement
        const target = this.#currentRowScrollTop()
        const lastRow = this.queue.at(-1)?.track.domElement
        let room = 0
        if (target && lastRow) {
            const contentBottom = lastRow.offsetTop + lastRow.offsetHeight + parseFloat(getComputedStyle(list).paddingBottom)
            room = Math.max(0, target + list.clientHeight - contentBottom)
        }
        this.#scrollSpacer.style.height = `${room}px`
    }

    /** Fades a copy of the divider that just left the list, at the place it was last seen. */
    #fadeRemovedHistoryDivider(previous: DOMRect | undefined) {
        const divider = this.#historyDivider
        if (!previous || divider.isConnected || reducedMotion.matches) return
        const bounds = this.#queueListElement.getBoundingClientRect()
        const ghost = divider.cloneNode() as HTMLElement
        Object.assign(ghost.style, {
            position: 'absolute',
            top: `${previous.top - bounds.top + this.#queueListElement.scrollTop}px`,
            left: '0',
            right: '0',
            margin: '0',
        })
        this.#queueListElement.appendChild(ghost)
        const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { ...queueMotion, fill: 'forwards' })
        this.#rowRemovals.add(animation)
        animation.onfinish = () => {
            ghost.remove()
            this.#rowRemovals.delete(animation)
        }
    }

    SyncQueueChanges(previousPositions = this.#getRowPositions(), revealCurrentRow = false) {
        for (const animation of this.#rowMoves.values()) animation.cancel()
        this.#rowMoves.clear()
        this.queue.forEach((entry, index) => this.#placeRow(entry, index))
        this.#syncHistoryDivider()
        this.#syncScrollRoom()
        // Scrolling before the rows are measured lets the move animation carry the scroll too.
        const currentRowScrollTop = this.#currentRowScrollTop()
        if (revealCurrentRow && currentRowScrollTop !== undefined) this.#queueListElement.scrollTop = currentRowScrollTop
        this.#fadeRemovedHistoryDivider(previousPositions.get(this.#historyDivider))
        bus.emit('queue:history-changed', { hasHistory: this.#historyLength > 0 })
        if (!reducedMotion.matches) {
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

    RemoveTracksFromQueue(trackEntries: readonly QueueTrackEntry[]) {
        const requested = new Set(trackEntries)
        const removing = this.queue.filter(entry => requested.has(entry))
        if (!removing.length) return
        const positions = this.#getRowPositions()
        const bounds = this.#queueListElement.getBoundingClientRect()
        const removingPlayingTrack = removing.some(entry => entry.track.isPlaying)
        if (removingPlayingTrack) this.#setPlayingTrack()

        this.#historyLength = this.queue.slice(0, this.#historyLength).filter(entry => !requested.has(entry)).length
        this.queue = this.queue.filter(entry => !requested.has(entry))
        for (const entry of removing) {
            if (entry.track.coverImage) URL.revokeObjectURL(entry.track.coverImage)
            const element = entry.track.domElement
            if (!element) continue
            const position = positions.get(element)!
            if (reducedMotion.matches) {
                this.#nearRows.unobserve(element)
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
                this.#nearRows.unobserve(element)
                element.remove()
                animation.cancel()
                this.#rowRemovals.delete(animation)
            }
        }
        this.SyncQueueChanges(positions, removingPlayingTrack)

        if (removingPlayingTrack) this.#playCurrentOrStop()
    }

    GetFirstSafeQueueIndex() {
        return this.#historyLength + (this.queue[this.#historyLength]?.track.isPlaying ? 1 : 0)
    }

    get HistoryLength() {
        return this.#historyLength
    }

    get HistoryDividerBounds() {
        return this.#historyDivider.isConnected ? this.#historyDivider.getBoundingClientRect() : undefined
    }

    GetLastSafeQueueIndex() {
        return this.queue.length
    }

    PlayNextTrack() {
        const currentEntry = this.queue[this.#historyLength]
        if (currentEntry) this.#setCurrentIndex(this.#historyLength + (currentEntry.track.isPlaying ? 1 : 0))
    }

    PlayPreviousTrack() {
        if (this.#historyLength > 0) this.#setCurrentIndex(this.#historyLength - 1)
    }

    /** Pauses or resumes the current track, and starts any other track. */
    PlayOrToggleEntry(trackEntry: QueueTrackEntry) {
        if (trackEntry.track.isPlaying) {
            Managers.PlayerManager.TogglePlayback()
            return
        }
        const index = this.queue.indexOf(trackEntry)
        if (index !== -1) this.#setCurrentIndex(index)
    }

    /** Makes the row at `index` current, so every row above it becomes history and every row below it upcoming. */
    #setCurrentIndex(index: number) {
        this.#historyLength = index
        this.#playCurrentOrStop()
        this.SyncQueueChanges(undefined, true)
    }

    #playCurrentOrStop() {
        if (this.queue[this.#historyLength]) {
            this.PlayCurrentTrack()
            return
        }
        this.#setPlayingTrack()
        Managers.PlayerManager.SkipCurrentTrack()
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
