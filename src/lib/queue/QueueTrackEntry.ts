import type { Track } from '../track/Track'

export class QueueTrackEntry {
    order: number
    track: Track

    constructor(track: Track, order: number) {
        this.track = track
        this.order = order
    }
}
