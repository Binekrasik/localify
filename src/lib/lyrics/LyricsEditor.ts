import { getTimestampTag } from './lrcutils'
import sqs from '../shortQuerySelector'
import { bus } from '../state/Managers'

export class LyricsEditor {
    state = {
        indicatorIndex: 0,
    }
    #audioElement: HTMLAudioElement

    constructor() {
        this.#audioElement = sqs<HTMLAudioElement>('#audioPlayer')
    }

    Enable() {
        sqs('#player-button-reset-lyrics').addEventListener('click', () => {
            bus.emit('lyrics:reset', {})
            bus.emit('lyrics:unsynced', {})
        })

        sqs('#player-button-mark-timestamp').addEventListener('click', () => {
            const time = this.#audioElement.currentTime

            const p = document.querySelector(`p[data-index="${this.state.indicatorIndex}"]`)
            if (!p || !(p instanceof HTMLParagraphElement)) return

            const lineTimestamp = sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"] .timestamp`) as HTMLSpanElement

            lineTimestamp.innerText = getTimestampTag(time)
            lineTimestamp.setAttribute('data-modified', 'true')

            this.state.indicatorIndex++
            bus.emit('lyrics:unsynced', {})
            sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })

            this.UpdateLineIndicator()
        })

        sqs('#player-button-prev-timestamp').addEventListener('click', () => {
            this.state.indicatorIndex = Math.max(this.state.indicatorIndex - 1, 0)

            try {
                bus.emit('lyrics:unsynced', {})
                sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
            } catch (e) {
                console.warn('No previous line available.')
            }

            this.UpdateLineIndicator()
        })

        sqs('#player-button-next-timestamp').addEventListener('click', () => {
            this.state.indicatorIndex = this.state.indicatorIndex + 1

            try {
                bus.emit('lyrics:unsynced', {})
                sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
            } catch (e) {
                console.warn('No next line available.')
            }

            this.UpdateLineIndicator()
        })
    }

    SetLyricsLineIndex(index: number) {
        this.state.indicatorIndex = index
        this.UpdateLineIndicator()
    }

    UpdateLineIndicator() {
        try {
            const p = sqs<HTMLParagraphElement>(`#lyrics p[data-index="${this.state.indicatorIndex}"]`)

            const x = p.offsetTop
            const y = p.offsetLeft - 15

            const indicator = sqs<HTMLParagraphElement>('#lyrics-editor-line-indicator')
            indicator.style = `top: ${x}px; left: ${y}px; height: ${p.offsetHeight}px;`
        } catch (e) {
            console.warn('No line indicator .')
        }
    }
}
