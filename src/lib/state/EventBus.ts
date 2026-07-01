import type { Track } from '../track/Track'

interface EventMap {
    'playback:play': Record<string, never>
    'playback:pause': Record<string, never>
    'playback:ended': Record<string, never>
    'playback:seek': Record<string, never>
    'track:loaded': { track: Track }
    'queue:play-request': { track: Track; play: boolean }
    'queue:next': Record<string, never>
    'queue:shuffle': Record<string, never>
    'lyrics:synced': Record<string, never>
    'lyrics:unsynced': Record<string, never>
    'lyrics:sync-request': Record<string, never>
    'lyrics:reset': Record<string, never>
}

export class EventBus {
    #listeners = new Map<string, Set<Function>>()

    on<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void {
        if (!this.#listeners.has(event))
            this.#listeners.set(event, new Set())
        this.#listeners.get(event)!.add(callback)
    }

    off<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void {
        this.#listeners.get(event)?.delete(callback)
    }

    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        console.debug(`[eventbus] Emitting ${event}`)
        this.#listeners.get(event)?.forEach(cb => cb(data))
    }
}
