import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseAudioFile } from '../track/parseAudioFile'
import { readLrcFile } from '../lyrics/lrcutils'

export class QueueManager extends Manager {
    queue: Track[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement

    Initialize() {
        // this.#queueListElement.innerHTML = ''
        this.#initHooks()
    }

    #initHooks() {
        this.#addToQueueInput.addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            if (!target.files || target.files.length < 1) return
            const files = [...target.files]

            const audioFiles = files.filter(file => file.type.startsWith('audio/'))
            const lyricsFiles = files.filter(file => file.name.endsWith('.lrc'))

            audioFiles.forEach(async audio => {
                const name = audio.name.toLowerCase().match(/(.*)\.[^.]+$/)
                const lyricsFile = name ? lyricsFiles.find(file => file.name.toLowerCase().includes(name[1])) : undefined
                const lyrics = lyricsFile ? await readLrcFile(lyricsFile).catch() : undefined

                const track = await parseAudioFile(audio)
                this.AddToQueue({ ...track, lyrics })
            })

            // reset the input value to allow adding the same files again if needed
            this.#addToQueueInput.value = ''
        })

        new MutationObserver(mutationList => {
            mutationList.forEach(mutation => {
                if (mutation.type !== 'childList') return

                if (this.#queueListElement.querySelectorAll('.queueItem').length === 0)
                    sqs('#queueContainer .queueEmptyIndicator').removeAttribute('data-hidden')
                else sqs('#queueContainer .queueEmptyIndicator').setAttribute('data-hidden', 'true')
            })
        }).observe(this.#queueListElement, { childList: true })
    }

    AddToQueue(track: Track) {
        const trackElement = document.createElement('div')
        trackElement.classList.add('queueItem')
        trackElement.setAttribute('data-playing', track.isPlaying ? 'true' : 'false')
        trackElement.innerHTML = `
            <img src="${track.coverImage ? track.coverImage : ''}" alt="No image" draggable="false" >
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="lyricsStatus" data-loaded="${track.lyrics ? 'true' : 'false'}">${track.lyrics ? 'lyrics loaded' : 'no lyrics'}</p>
            </div>
        `

        this.#queueListElement.appendChild(trackElement)
        this.queue.push({ ...track, domElement: trackElement })
    }

    PlayCurrentTrack() {
        const track = this.queue[0]
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement.querySelectorAll('.queueItem')[0].setAttribute('data-playing', 'true')
    }

    RemoveTrackElement(element: HTMLElement) {
        element.setAttribute('data-removed', 'true')
        element.style.top = `${element.offsetTop}px`
        element.style.left = `${element.offsetLeft}px`
        element.style.position = 'absolute'

        Managers.UpdateManager.CreateTimer({
            callback: () => { element.remove() },
            delay: 300,
        })
    }

    PlayNextTrack() {
        console.log('Playing next track in queue.')

        Managers.LyricsManager.ResetLyrics()
        Managers.PlayerManager.SkipCurrentTrack()

        if (this.queue.length > 0)
            if (this.queue[0].isPlaying) {
                const removed = this.queue.shift()
                this.RemoveTrackElement(removed?.domElement!)
            }

        if (this.queue.length === 0) return

        this.queue[0].isPlaying = true
        this.queue[0].domElement!.setAttribute('data-playing', 'true')
        Managers.PlayerManager.LoadTrack(this.queue[0], true)
    }
}