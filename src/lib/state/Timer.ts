export interface Timer {
    /**
     * A function to be executed after the timeout has been reached.
     */
    callback: () => void
    
    /**
     * Determines how long after the creation of the Timer should it execute the callback function.
     */
    timeout: number

    /**
     * internal - will be reset on creation and has no effect.
     */
    timeRemaining?: number

    /**
     * Optional - Limits how many times will the callback function be executed.
     */
    iterations?: number
}