import { getTimestampTag } from './lrcutils'
import sqs from '../shortQuerySelector'
import { Managers } from '../state/Managers'

export class LyricsEditor {
    state = {
        isEditing: false,
        indicatorIndex: 0,
    }

    Disable() {

    }

    Enable() {
        sqs('#player-button-reset-lyrics').addEventListener('click', () => {
            Managers.LyricsManager.ResetLyrics()
            Managers.LyricsManager.ParseLoadLyricsText()
            Managers.LyricsManager.UnsyncLyrics()
        })

        sqs('#player-button-mark-timestamp').addEventListener('click', () => {
            if (!Managers.LyricsManager.state.editingMode) return

            const time = Managers.PlayerManager.audioElement.currentTime // slight offset to account for human delay
            
            const p = document.querySelector(`p[data-index="${this.state.indicatorIndex}"]`)
            if (!p || !(p instanceof HTMLParagraphElement)) return

            const lineTimestamp = sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"] .timestamp`) as HTMLSpanElement

            lineTimestamp.innerText = getTimestampTag(time)
            lineTimestamp.setAttribute('data-modified', 'true')

            this.state.indicatorIndex++

            Managers.LyricsManager.UnsyncLyrics()
            sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })

            this.UpdateLineIndicator()
        })

        sqs('#player-button-prev-timestamp').addEventListener('click', () => {
            if (!Managers.LyricsManager.state.editingMode) return

            this.state.indicatorIndex = Math.max(this.state.indicatorIndex - 1, 0)

            try {
                // sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"] .timestamp`).innerText = '[00:00.00]'
                Managers.LyricsManager.UnsyncLyrics()
                sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
            } catch (e) {
                console.warn('No previous line available.')
            }

            this.UpdateLineIndicator()
        })

        sqs('#player-button-next-timestamp').addEventListener('click', () => {
            if (!Managers.LyricsManager.state.editingMode) return

            this.state.indicatorIndex = Math.max(this.state.indicatorIndex + 1, 0)
            
            try {
                // sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"] .timestamp`).innerText = '[00:00.00]'
                Managers.LyricsManager.UnsyncLyrics()
                sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
            } catch (e) {
                console.warn('No next line available.')
            }

            this.UpdateLineIndicator()
        })
    }

    SetLyricsLineIndex (index: number) {
        if (!Managers.LyricsManager.state.editingMode) return

        this.state.indicatorIndex = index
        this.UpdateLineIndicator()
    }

    UpdateLineIndicator () {
        if (!Managers.LyricsManager.state.editingMode) return

        try {
            const p = sqs(`#lyrics p[data-index="${this.state.indicatorIndex}"]`) as HTMLParagraphElement

            const x = p.offsetTop
            const y = p.offsetLeft - 15

            const indicator = sqs('#lyrics-editor-line-indicator') as HTMLParagraphElement
            indicator.style = `top: ${x}px; left: ${y}px; height: ${p.offsetHeight}px;`
        } catch (e) {
            console.warn('No line indicator .')
        }
    }
}