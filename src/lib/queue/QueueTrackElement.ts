import { createElement } from '../domUtils'
import type { ContextMenuEntry } from '../interaction/ContextMenuEntry'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'

export class QueueTrackEntry {
    order: number
    track: Track

    constructor(track: Track, order: number) {
        this.track = track
        this.order = order
    }

    GetContextMenuEntries(): ContextMenuEntry[] {
        const entries: ContextMenuEntry[] = []

        entries.push({
            icon: createElement('img', { src: '/assets/icons/keyboard_double_arrow_up.svg' }),
            text: createElement('p', {}, 'Move to top'),
            onClick: _ => {
                Managers.QueueManager.SetTrackOrder(this, Managers.QueueManager.GetFirstSafeQueueIndex())
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/arrow_upward.svg' }),
            text: createElement('p', {}, 'Move up'),
            onClick: _ => {
                const firstSafeIndex = Managers.QueueManager.GetFirstSafeQueueIndex()
                Managers.QueueManager.SetTrackOrder(
                    this,
                    firstSafeIndex > this.order - 1
                        ? firstSafeIndex
                        : this.order - 1
                )
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/arrow_downward.svg' }),
            text: createElement('p', {}, 'Move down'),
            onClick: _ => {
                const lastSafeIndex = Managers.QueueManager.GetLastSafeQueueIndex()

                Managers.QueueManager.SetTrackOrder(
                    this,
                    lastSafeIndex < this.order + 1
                        ? lastSafeIndex
                        : this.order + 1
                )
            },
        })

        entries.push({
            icon: createElement('img', { src: '/assets/icons/delete.svg' }),
            text: createElement('p', {}, 'Remove from queue'),
            onClick: _ => {
                Managers.QueueManager.RemoveTrackFromQueue(this)
            },
        })

        return entries
    }
}
