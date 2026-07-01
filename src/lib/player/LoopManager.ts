import { Manager } from '../Manager'
import sqs from '../shortQuerySelector'
import { bus, updateManager } from '../state/Managers'

export class LoopManager extends Manager {
    public startSeconds: number | null = null
    public endSeconds: number | null = null
    #loopTimerId: number | null = null
    #audioElement = sqs<HTMLAudioElement>('#audioPlayer')

    Initialize(): void {
        this.#initHooks()
    }

    #initHooks(): void {
        sqs<HTMLButtonElement>('#player-button-mark-loop-start').addEventListener('click', () => {
            this.SetStart(this.#audioElement.currentTime)
        })

        sqs<HTMLButtonElement>('#player-button-mark-loop-end').addEventListener('click', () => {
            this.SetEnd(this.#audioElement.currentTime)
        })

        sqs<HTMLButtonElement>('#player-button-clear-loop').addEventListener('click', () => {
            this.ClearLoop()
        })

        this.#audioElement.addEventListener('loadstart', () => {
            this.ClearLoop()
        })

        bus.on('playback:play', () => {
            this.#cancelLoopTimer()
            this.#loopTimerId = updateManager.CreateTimer({
                callback: (): void | boolean => {
                    if (this.#audioElement.paused)
                        return true

                    if (this.startSeconds === null || this.endSeconds === null)
                        return

                    if (this.#audioElement.currentTime >= this.endSeconds) {
                        this.#audioElement.currentTime = this.startSeconds
                        bus.emit('playback:seek', {})
                    }
                },
                delay: 50,
            })
        })
    }

    #cancelLoopTimer(): void {
        if (this.#loopTimerId !== null) {
            updateManager.RemoveTimer(this.#loopTimerId)
            this.#loopTimerId = null
        }
    }

    ClearLoop(): void {
        this.startSeconds = null
        this.endSeconds = null
    }

    SetStart(time: number): number {
        this.startSeconds = Math.max(time, 0)
        return this.startSeconds
    }

    SetEnd(time: number): number {
        this.endSeconds = Math.min(time, this.#audioElement.duration)
        return this.endSeconds
    }
}
