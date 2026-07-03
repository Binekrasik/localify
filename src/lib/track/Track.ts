export interface Track {
    audioFile: File | Blob
    title: string
    artist: string
    coverImage?: string
    lyrics?: string
    domElement?: HTMLDivElement
    isPlaying: boolean
    accentColor: string
    format: string
    coverState: 'loading' | 'loaded' | 'none'
}
