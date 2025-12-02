export interface Timer {
    /**
     * A function to be executed after the timeout has been reached.
     * @returns returning `true` will stop the timer. Anything other value will be ignored
     */
    callback: () => void | boolean
    
    /**
     * Determines the delay between each iterations of the Timer.
     * Minimum value will be capped to the updateInterval of UpdateManager at the time of Timer creation.
     */
    delay: number

    /**
     * internal - will be reset on creation and has no effect.
     */
    timeRemaining?: number

    /**
     * Optional - Limits how many times will the callback function be executed.
     * If ommited, the Timer won't end until either stopped or removed.
     */
    iterations?: number
}