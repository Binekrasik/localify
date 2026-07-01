import { Manager } from '../Manager'
import type { Timer } from './Timer'

export class UpdateManager extends Manager {
    static DoUpdates = true
    listeners: Array<() => void> = []
    #timers: (Timer & { id: number })[] = []
    #nextTimerId = 0

    #lastUpdateTimestamp = 0
    readonly updateInterval = 0

    CreateTimer(timer: Timer): number {
        const id = this.#nextTimerId++
        this.#timers.push({ ...timer, id, timeRemaining: timer.delay })
        return id
    }

    RemoveTimer(id: number): void {
        this.#timers = this.#timers.filter(t => t.id !== id)
    }

    #TickTimers(delta: number) {
        const deadIds = new Set<number>()

        for (const timer of this.#timers) {
            if (!timer.timeRemaining) {
                console.warn('Cannot tick an invalid timer.')
                deadIds.add(timer.id)
                continue
            }

            timer.timeRemaining -= delta

            if (timer.timeRemaining <= 0) {
                const callback = timer.callback()

                if (timer.iterations && timer.iterations > 1 && callback !== true) {
                    timer.iterations--
                } else if (timer.iterations || callback === true) {
                    deadIds.add(timer.id)
                }

                timer.timeRemaining = timer.delay
            }
        }

        if (deadIds.size > 0)
            this.#timers = this.#timers.filter(t => !deadIds.has(t.id))
    }

    Initialize() {
        this.#lastUpdateTimestamp = performance.now()
        this.Update()
    }

    Update() {
        window.requestAnimationFrame(timestamp => {
            const deltaTime = timestamp - this.#lastUpdateTimestamp

            if (deltaTime >= this.updateInterval && UpdateManager.DoUpdates) {
                this.#CallListeners()
                this.#TickTimers(deltaTime)

                this.#lastUpdateTimestamp = timestamp
            }

            this.Update()
        })
    }

    #CallListeners() {
        this.listeners.forEach(listener => listener())
    }

    AddUpdateListener(listener: () => void) {
        this.listeners.push(listener)
    }

    RemoveUpdateListener(listener: () => void) {
        this.listeners = this.listeners.filter(l => l !== listener)
    }
}
