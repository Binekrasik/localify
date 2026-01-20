import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseAudioFile } from '../track/parseAudioFile'
import { readLrcFile } from '../lyrics/lrcutils'
import { QueueTrackEntry } from './QueueTrackElement'

export class QueueManager extends Manager {
    queue: QueueTrackEntry[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement

    Initialize() {
        // this.#queueListElement.innerHTML = ''
        this.#initHooks()
        // this.AddInitialTrackElement({} as Track)
    }

    #initHooks() {
        this.#addToQueueInput.addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const files = target.files
            if (!files || files.length < 1) return

            const filesArray = [...files]
            filesArray
                .filter(file => file.type.startsWith('audio/'))
                .forEach(audioFile => {
                    const initialTrack = {} as Track
                    this.AddInitialTrackElement(initialTrack)

                    const match = audioFile.name
                        .toLowerCase()
                        .match(/(.*)\.[^.]+$/)
                    if (!match) return false

                    const lyricsFile = [...files].find(file => {
                        console.log(`Comparing ${file.name.toLowerCase()} with ${match[1]}`)

                        return (
                            file.name.toLowerCase().includes(match[1]) &&
                            file.name.toLowerCase().endsWith('.lrc')
                        )
                    })

                    this.AddTrackFromFile(audioFile, lyricsFile, initialTrack)
                })

            // reset the input value to allow adding the same files again if needed
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

    AddTrackFromFile(audioFile: File, lyricsFile?: File, initialTrack?: Track) {
        new Promise<void>(async (resolve, _reject) => {
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
                    // continue without lyrics
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
                <p class="lyricsStatus" data-loading="true"><span>loading lyrics</span></p>
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
                <p class="lyricsStatus" data-loaded="${Boolean(track.lyrics)}">${track.lyrics ? 'lyrics loaded' : 'no lyrics'}</p>
            </div>
        `

        domTrackElement.addEventListener('mousedown', event => {
            if (event.button != 2) return

            Managers.ContextMenuManager.PopulateContextMenu(trackEntry.GetContextMenuEntries())
            Managers.ContextMenuManager.ShowContextMenu(event.clientX, event.clientY )
        })

        trackEntry.track.domElement = domTrackElement
        trackEntry.order = this.queue.length
        domTrackElement.style.order = `${trackEntry.order}`
        domTrackElement.setAttribute('data-order', `${trackEntry.order}`)

        this.#queueListElement.appendChild(domTrackElement)
        this.queue.push(trackEntry)
    }

    PlayCurrentTrack() {
        const trackEntry = this.queue[0]
        if (!trackEntry) return

        Managers.PlayerManager.LoadTrack(trackEntry.track, true)
        this.#queueListElement
            .querySelectorAll('.queueItem')[0]
            .setAttribute('data-playing', 'true')
    }

    RemoveTrackElement(element: HTMLElement) {
        element.setAttribute('data-removed', 'true')
        element.style.top = `${element.offsetTop}px`
        element.style.left = `${element.offsetLeft}px`
        element.style.position = 'absolute'

        Managers.UpdateManager.CreateTimer({
            callback: () => element.remove(),
            delay: 300,
        })
    }

    SetTrackOrder(trackEntry: QueueTrackEntry, order: number) {
        if (order < 0) {
            console.warn('Cannot reorder a track with order less than 0')
            return
        }

        console.log(this.queue)

        console.log(`Target track index: ${this.queue.indexOf(trackEntry)}`)
        console.log(`Target track order: ${trackEntry.order}`)
        console.log(`Given order       : ${order}`)

        // reorder the given track
        trackEntry.order = order
        this.queue.splice(this.queue.indexOf(trackEntry), 1)
        this.queue.splice(order, 0, trackEntry)

        console.log(`Index after change: ${this.queue.indexOf(trackEntry)}`)

        // reorder existing tracks
        this.queue.forEach((entry, index) => {
            entry.order = index
            entry.track.domElement?.setAttribute('data-order', `${index}`)
            entry.track.domElement!.style.order = `${index}`
        })

        console.log(this.queue)

        console.log(`End index         : ${this.queue.indexOf(trackEntry)}`)
        console.log(`End order         : ${this.queue[this.queue.indexOf(trackEntry)].order}`)
        console.log(`End data order    : ${trackEntry.track.domElement!.getAttribute('data-order')}`)
    }

    PlayNextTrack() {
        console.log('Playing next track in queue.')

        Managers.LyricsManager.ResetLyrics()
        Managers.PlayerManager.SkipCurrentTrack()

        if (this.queue.length > 0)
            if (this.queue[0].track.isPlaying) {
                const removed = this.queue.shift()
                this.RemoveTrackElement(removed?.track.domElement!)
            }

        if (this.queue.length === 0) return

        const newEntry = this.queue[0]
        newEntry.track.isPlaying = true
        newEntry.track.domElement!.setAttribute('data-playing', 'true')
        Managers.PlayerManager.LoadTrack(newEntry.track, true)
    }
}
