export interface Track {
    audioFile: File | Blob
    title: string
    artist: string
    coverImage?: string
    fullCoverImage?: string
    lyrics?: string
    domElement?: HTMLDivElement
    isPlaying: boolean
    accentColor: string
    format: string
}
