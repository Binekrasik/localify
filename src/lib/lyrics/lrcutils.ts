export function getTimestampTag(time: number): string {
    // help
    // i love string manipulation
    return `[${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}.${(time % 60 % 1 * 100).toString().slice(0, 2).replaceAll('.', '').padStart(2, '0')}]`
}

export function getTimeFromTimestampTag(tag: string): number {
    const match = tag.match(/\[(\d{2}):(\d{2})\.(\d{2})\]/)
    if (!match) return 0
    const minutes = parseInt(match[1])
    const seconds = parseInt(match[2])
    const centiseconds = parseInt(match[3])
    return minutes * 60 + seconds + centiseconds / 100
}