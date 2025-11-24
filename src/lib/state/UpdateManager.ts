import { Manager } from '../Manager'

export class UpdateManager extends Manager {
    static DoUpdates = true
    listeners: Array<() => void> = []

    state = {
        lastUpdateTimestamp: 0,
        updateInterval: 10, // in ms
    }
    
    Initialize () {
        this.state.lastUpdateTimestamp = performance.now()
        this.Update()
    }

    Update() {
        window.requestAnimationFrame(timestamp => {
            if (timestamp - this.state.lastUpdateTimestamp >= this.state.updateInterval && UpdateManager.DoUpdates) {
                this.CallListeners()

                this.state.lastUpdateTimestamp = timestamp
            }

            this.Update()
        })
    }

    CallListeners() {
        this.listeners.forEach(listener => listener())
    }

    AddUpdateListener(listener: () => void) {
        this.listeners.push(listener)
    }

    RemoveUpdateListener(listener: () => void) {
        this.listeners = this.listeners.filter(l => l !== listener)
    }
}