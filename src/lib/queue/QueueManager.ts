import sqs from '../safeQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseAudioFile } from '../track/parseImage'

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
            const files = target.files
            if (!files || files.length < 1) return

            [...files]
                .filter(file => file.type.startsWith('audio/'))
                .forEach(audioFile => {
                    const match = audioFile.name.toLowerCase().match(/(.*)\.[^.]+$/)
                    if (!match) return false

                    const lyricsFile = [...files]
                        .find(file => {
                            console.log('Comparing', file.name.toLowerCase(), 'with', match[1])

                            return file.name
                                .toLowerCase()
                                .startsWith(match[1])
                                && file.name.toLowerCase().endsWith('.lrc')
                        })

                    parseAudioFile(audioFile).then(track => {
                        this.AddToQueue({ ...track, lyricsFile: lyricsFile || undefined })
                    })
                })

            // reset the input value to allow adding the same files again if needed
            this.#addToQueueInput.value = ''
        })
    }

    AddToQueue(track: Track) {
        const trackElement = document.createElement('div')
        trackElement.classList.add('queueItem')
        trackElement.setAttribute('data-playing', track.isPlaying ? 'true' : 'false')
        trackElement.innerHTML = `
            <img src="${track.coverImage ? track.coverImage : ''}" alt="No image" >
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="lyricsStatus" data-loaded="${track.lyricsFile ? 'true' : 'false'}">${track.lyricsFile ? 'lyrics loaded' : 'no lyrics'}</p>
            </div>
`
        this.#queueListElement.appendChild(trackElement)
        this.queue.push({...track, domElement: trackElement})
    }

    PlayCurrentTrack() {
        const track = this.queue[0]
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement.querySelectorAll('.queueItem')[0].setAttribute('data-playing', 'true')
    }

    PlayNextTrack() {
        console.log('Playing next track in queue.')

        if (this.queue.length > 0)
            if (this.queue[0].isPlaying) {
                const removed = this.queue.shift()
                removed?.domElement!.remove()
            }

        if (this.queue.length === 0) return

        this.queue[0].isPlaying = true
        this.queue[0].domElement!.setAttribute('data-playing', 'true')
        Managers.PlayerManager.LoadTrack(this.queue[0], true)
    }
}