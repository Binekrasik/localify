import { Manager } from '../Manager'
import type { Timer } from './Timer'

export class UpdateManager extends Manager {
    static DoUpdates = true
    listeners: Array<() => void> = []
    timers: Timer[] = []

    #lastUpdateTimestamp = 0
    readonly updateInterval = 1000 / 100 // tick interval in milliseconds; default is 100x a second (10ms)

    /**
     * Creates a timer running within the internal ticker.
     */
    CreateTimer (timer: Timer): void {
        timer.timeRemaining = timer.timeout
        this.timers.push(timer)
    }

    /**
     * Iterates and ticks all registered timers.
     * @param delta time since the last tick in milliseconds
     */
    #TickTimers (delta: number) {
        this.timers.forEach((timer, index) => {
            // remove the timer if it's not correctly configured
            if (!timer.timeRemaining) {
                console.warn('Cannot tick an invalid timer.')
                this.timers.splice(index, 1)
                
                return
            }

            // tick the timer
            timer.timeRemaining -= delta
            
            if (timer.timeRemaining <= 0) {
                timer.callback()
                
                if (timer.iterations && timer.iterations > 1){
                    timer.iterations--
                    timer.timeRemaining = timer.timeout
                } else this.timers.splice(index, 1)
            }
        })
    }
    
    Initialize () {
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