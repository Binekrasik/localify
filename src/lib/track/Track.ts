export interface Track {
    audioFile: File | Blob
    title: string
    artist: string
    album?: string
    coverImage?: string
    lyrics?: string
    domElement?: HTMLDivElement
    isPlaying: boolean
    accentColor: string
    /** The file name's extension, lowercased; '' without one. */
    format: string
    /** The container's name, such as 'Ogg' or 'MPEG-4'. */
    container?: string
    /** The codec's name, such as 'Opus' or 'AAC'. */
    codec?: string
    /** The audio stream's average bitrate in kbit/s. */
    bitrate?: number
    /** When this release came out, as the tag spells it: usually 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
    released?: string
    /** When the recording first came out, spelled like `released`. */
    firstReleased?: string
    coverState: 'loading' | 'loaded' | 'none'
}
