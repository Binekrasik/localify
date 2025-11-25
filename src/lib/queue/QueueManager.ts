import sqs from '../../safeQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from './Track'

export class QueueManager extends Manager {
    queue: Track[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    
    Initialize() {
        this.#queueListElement.innerHTML = ''
    }

    AddToQueue(track: Track) {
        this.queue.push(track)

        const trackElement = document.createElement('div')
        trackElement.classList.add('queue-item')
        trackElement.innerHTML = `<p>${track.audioFile.name}</p><p>${track.lyricsFile ? track.lyricsFile.name : 'No lyrics'}</p>`
        this.#queueListElement.appendChild(trackElement)
    }

    PlayNextTrack() {
        const track = this.queue.shift()
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement.removeChild(this.#queueListElement.firstChild!)
    }
}