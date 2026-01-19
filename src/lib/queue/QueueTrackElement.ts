import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'
import type { Track } from '../track/Track'

export class QueueTrackElement {
    track: Track

    constructor(track: Track) {
        this.track = track
    }

    GetContextMenuEntries(): ContextMenuEntry[] {
        const entries: ContextMenuEntry[] = []

        entries.push({
            icon: createElement('img', { src: '/assets/icons/keyboard_double_arrow_up.svg' }),
            text: createElement('p', {}, 'Move to top'),
            onClick: event => {
                alert('Moved to top')
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/arrow_upward.svg' }),
            text: createElement('p', {}, 'Move up'),
            onClick: event => {
                alert('Moved up')
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/arrow_downward.svg' }),
            text: createElement('p', {}, 'Move down'),
            onClick: event => {
                alert('Moved down')
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/delete.svg' }),
            text: createElement('p', {}, 'Remove from queue'),
            onClick: event => {
                alert('Removed from queue')
            },
        })

        return entries
    }
}
