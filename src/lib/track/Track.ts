export interface Track {
    audioFile: File
    title: string
    artist: string
    coverImage?: string
    lyrics?: string
    domElement?: HTMLDivElement
    isPlaying: boolean
    accentColor: string
    format: string
}
