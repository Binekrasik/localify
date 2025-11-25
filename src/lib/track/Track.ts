export interface Track {
    audioFile: File
    title: string
    artist: string
    /**
     * Base64-encoded cover image
     */
    coverImage?: string
    lyricsFile?: File
    domElement?: HTMLDivElement
    isPlaying: boolean
}