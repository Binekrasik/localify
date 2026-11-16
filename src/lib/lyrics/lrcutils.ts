/** A lyrics line that starts at a time: `[mm:ss.xx]` and the text after it. */
export const timedLinePattern = /\[(\d{2}):(\d{2}\..*?)\](.*)/

/** A time inside a line, `<mm:ss.xx>`, which says when the word after it starts. */
const wordTimePattern = /<\d{2}:\d{2}\.\d+>/

export type LyricsKind = 'plain' | 'synced' | 'word-synced'

/** How finely lyrics text is timed: per word, per line, or not at all. */
export function getLyricsKind(text: string): LyricsKind {
    if (!timedLinePattern.test(text)) return 'plain'
    return wordTimePattern.test(text) ? 'word-synced' : 'synced'
}

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
