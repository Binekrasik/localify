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
            this.ProcessAudioAndLyricsFiles(filesArray)

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
                    // console.log(`Comparing ${file.name.toLowerCase()} with ${match[1]}`)

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

    AddTrackFromBlob(blob: Blob) {
        new Promise<void>(async (resolve, _reject) => {
            console.log(`Adding blob track`)
            let track = await parseAudioFile(blob)

            this.AddToQueue({ ...track })
            console.log(`Track added! ${track.audioFile.type}`)

            resolve()
        }).catch(() => {
            console.warn(`Failed to add a blob track.`)
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

    SetTrackOrder(trackEntry: QueueTrackEntry, order: number) {
        if (order < 0) {
            console.warn('Cannot reorder a track with order less than 0')
            return
        }

        // reorder the given track
        trackEntry.order = order
        this.queue.splice(this.queue.indexOf(trackEntry), 1)
        this.queue.splice(order, 0, trackEntry)

        // reorder existing tracks
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

        Managers.UpdateManager.CreateTimer({
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
