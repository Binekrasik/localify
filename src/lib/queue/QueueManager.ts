import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { bus, updateManager, Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseAudioFile } from '../track/parseAudioFile'
import { readLrcFile } from '../lyrics/lrcutils'
import { QueueTrackEntry } from './QueueTrackEntry'
import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'

export class QueueManager extends Manager {
    queue: QueueTrackEntry[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement

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

        new MutationObserver(mutationList => {
            mutationList.forEach(mutation => {
                if (mutation.type !== 'childList') return

                if (
                    this.#queueListElement.querySelectorAll('.queueItem')
                        .length === 0
                )
                    sqs('#queueContainer .queueEmptyIndicator').removeAttribute(
                        'data-hidden',
                    )
                else
                    sqs('#queueContainer .queueEmptyIndicator').setAttribute(
                        'data-hidden',
                        'true',
                    )
            })
        }).observe(this.#queueListElement, { childList: true })
    }

    ProcessAudioAndLyricsFiles(files: File[]) {
        console.log("Adding files:")

        files
            .filter(file => file.type.startsWith('audio/'))
            .forEach(audioFile => {
                console.log(`Adding: ${audioFile.name}`)

                const initialTrack = {} as Track
                this.AddInitialTrackElement(initialTrack)

                const match = audioFile.name
                    .toLowerCase()
                    .match(/(.*)\.[^.]+$/)
                if (!match) return false

                const lyricsFile = files.find(file => {
                    return (
                        file.name.toLowerCase().includes(match[1]) &&
                        file.name.toLowerCase().endsWith('.lrc')
                    )
                })

                const splitName = audioFile.name.split('.')
                initialTrack.format = splitName[splitName.length - 1]

                this.AddTrackFromFile(audioFile, lyricsFile, initialTrack)
            })
    }

    AddTrackFromFile(audioFile: File, lyricsFile?: File, initialTrack?: Track) {
        new Promise<void>(async (resolve, _reject) => {
            console.log(`Audio file name: ${audioFile.name}`)
            let track = await parseAudioFile(audioFile)

            if (initialTrack?.domElement)
                track.domElement = initialTrack.domElement

            let text: string | undefined
            if (lyricsFile) {
                try {
                    text = await readLrcFile(lyricsFile)
                } catch (exception) {
                    console.warn(
                        `Failed to load lyrics for track ${track.title}`,
                    )
                }
            }

            this.AddToQueue({ ...track, lyrics: text })
            console.log('Track added!')

            resolve()
        }).catch(() => {
            console.warn(`Failed to add track ${audioFile.name}.`)
        })
    }

    AddInitialTrackElement(track: Track) {
        const element = document.createElement('div')
        element.classList.add('queueItem')
        element.innerHTML = `
            <img src="/assets/loader.svg" class="loader">
            <div class="trackInfo">
                <p class="name" data-loading="true"><span>loading some weird track</span></p>
                <p class="trackStatus" data-loading="true"><span class="lyrics">loading lyrics</span></p>
            </div>
        `

        this.#queueListElement.appendChild(element)
        track.domElement = element
    }

    AddToQueue(track: Track) {
        const trackEntry = new QueueTrackEntry(track, -1)
        const domTrackElement = track.domElement || document.createElement('div')

        domTrackElement.classList.add('queueItem')
        domTrackElement.setAttribute(
            'data-playing',
            track.isPlaying ? 'true' : 'false',
        )

        domTrackElement.innerHTML = `
            <img src="${track.coverImage || ''}" alt="No image" >
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="trackStatus" data-loaded="${Boolean(track.lyrics)}"><span class="format">${track.format}</span><span class="lyrics">${track.lyrics ? 'lyrics loaded' : 'no lyrics'}</span></p>
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
                    if (trackEntry.track.fullCoverImage)
                        window.open(trackEntry.track.fullCoverImage, '_blank')?.focus()
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
        console.log('Playing next track in queue.')

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
