export interface Timer {
    callback: () => void | boolean
    delay: number
    timeRemaining?: number
    iterations?: number
}
