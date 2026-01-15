export interface Track {
    audioFile: File
    title: string
    artist: string
    /** Base64-encoded cover image */
    coverImage?: string
    lyrics?: string
    domElement?: HTMLDivElement
    isPlaying: boolean
    accentColor: string
}
