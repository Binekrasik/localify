import { Manager } from '../Manager'
import { bus, Managers, updateManager } from '../state/Managers'
import type { Track } from '../track/Track'

interface NowPlaying {
    title: string
    artist?: string
    album?: string
    durationMs?: number
    positionMs?: number
    paused: boolean
}

const endpoint = 'ws://127.0.0.1:2137'
const token: string | null = null
const heartbeatDelay = 10_000
const reconnectDelay = 15_000

/**
 * Communicates live status with the specified presencify server.
 */
export class PresenceManager extends Manager {
    #socket: WebSocket | null = null
    #track: Track | null = null
    #connecting = false

    Initialize() {
        this.#Connect()
        this.#initBusListeners()

        updateManager.CreateTimer({
            delay: heartbeatDelay,
            callback: () => {
                this.#Report()
                return false
            },
        })
    }

    #initBusListeners() {
        bus.on('track:loaded', ({ track }) => {
            this.#track = track
            this.#Report()
        })

        bus.on('playback:play', () => this.#Report())
        bus.on('playback:pause', () => this.#Report())
        bus.on('playback:seek', () => this.#Report())

        bus.on('playback:ended', () => {
            this.#track = null
            this.#Send({ type: 'clear' })
        })

        window.addEventListener('beforeunload', () => this.#Send({ type: 'clear' }))
    }

    #Connect() {
        if (this.#socket || this.#connecting)
            return

        this.#connecting = true

        const socket = new WebSocket(endpoint)

        socket.addEventListener('open', () => {
            this.#socket = socket
            this.#connecting = false
            this.#Send({ type: 'hello', client: 'localify', token })
            this.#Report()
        })

        socket.addEventListener('message', event => {
            if (JSON.parse(event.data).type === "welcome")
                console.log(`Connected to presencify at ${endpoint}`)
        })

        socket.addEventListener('close', () => {
            this.#socket = null
            this.#connecting = false
            setTimeout(() => this.#Connect(), reconnectDelay)
        })

        socket.addEventListener('error', () => socket.close())
    }

    #Send(message: unknown) {
        if (this.#socket?.readyState === WebSocket.OPEN)
            this.#socket.send(JSON.stringify(message))
    }

    #Report() {
        if (!this.#track)
            return

        const audio = Managers.PlayerManager.audioElement

        const payload: NowPlaying = {
            title: this.#track.title,
            artist: this.#track.artist,
            album: this.#track.album,
            durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : undefined,
            positionMs: audio.currentTime * 1000,
            paused: audio.paused,
        }

        this.#Send({ type: 'update', payload })
    }
}
