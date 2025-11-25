import sqs from '../safeQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseCoverImage } from '../track/parseImage'

export class QueueManager extends Manager {
    queue: Track[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement

    Initialize() {
        this.#queueListElement.innerHTML = ''
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

                    parseCoverImage(audioFile).then(image => {
                        this.AddToQueue({ audioFile: audioFile, coverImage: image || undefined, lyricsFile: lyricsFile })
                    })
                })

            // reset the input value to allow adding the same files again if needed
            this.#addToQueueInput.value = ''
        })
    }

    AddToQueue(track: Track) {
        this.queue.push(track)

        const trackElement = document.createElement('div')
        trackElement.classList.add('queueItem')
        trackElement.innerHTML = `<img src="${track.coverImage ? track.coverImage : ''}" width="200" alt="idk" ><p>${track.audioFile.name}</p><p>${track.lyricsFile ? track.lyricsFile.name : 'No lyrics'}</p>`
        this.#queueListElement.appendChild(trackElement)
    }

    PlayNextTrack() {
        const track = this.queue.shift()
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement.removeChild(this.#queueListElement.firstChild!)
    }
}