export interface Track {
    audioFile: File,
    /**
     * Base64-encoded cover image
     */
    coverImage?: string,
    lyricsFile?: File,
}