export function getLogarithmicVolume(volume: number): number {
    // volume is from 0 to 100
    // convert to 0.0 - 1.0
    // apply logarithmic scale
    const log = Math.log(volume / 0.01) / Math.log(1 / 0.01)
    console.log(log)
    return log
}