import { Manager } from '../Manager'
import sqs from '../shortQuerySelector'
import { Managers } from '../state/Managers'

export class LoopManager extends Manager {
    public startSeconds: number | null = null
    public endSeconds: number | null = null

    Initialize(): void {
        this.#initHooks()
    }

    #initHooks(): void {
        sqs<HTMLButtonElement>('#player-button-mark-loop-start').addEventListener('click', () => {
            this.SetStart(Managers.PlayerManager.audioElement.currentTime)
        })

        sqs<HTMLButtonElement>('#player-button-mark-loop-end').addEventListener('click', () => {
            this.SetEnd(Managers.PlayerManager.audioElement.currentTime)
        })

        sqs<HTMLButtonElement>('#player-button-clear-loop').addEventListener('click', () => {
            this.ClearLoop()
        })

        Managers.PlayerManager.audioElement.addEventListener('loadstart', () => {
            this.ClearLoop()
        })

        Managers.PlayerManager.audioElement.addEventListener('play', () => {
            Managers.UpdateManager.CreateTimer({
                callback: (): void | boolean => {
                    if (Managers.PlayerManager.audioElement.paused)
                        return true

                    if (this.startSeconds === null || this.endSeconds === null)
                        return

                    if (Managers.PlayerManager.audioElement.currentTime > this.endSeconds)
                        Managers.PlayerManager.audioElement.currentTime = this.startSeconds
                }, delay: 50
            })
        })
    }

    ClearLoop(): void {
        this.startSeconds = null
        this.endSeconds = null
    }

    /**
     * Sets the end of the loop
     * @param time Start of the loop in seconds
     * @return Start timestamp in seconds
     */
    SetStart(time: number): number {
        this.startSeconds = Math.max(time, 0)
        return this.startSeconds
    }

    /**
     * Sets the end of the loop
     * @param time End of the loop in seconds
     * @return End timestamp in seconds
     */
    SetEnd(time: number): number {
        this.endSeconds = Math.min(time, Managers.PlayerManager.audioElement.duration)
        return this.endSeconds
    }
}
