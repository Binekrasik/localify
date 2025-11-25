import { parseWebStream } from 'music-metadata'
import { uint8ArrayToBase64 } from 'uint8array-extras'
import type { Track } from './Track'

export async function parseAudioFile(audioFile: File): Promise<Track> {
    const metadata = await parseWebStream(audioFile.stream(), {
        mimeType: audioFile.type,
        size: audioFile.size,
        path: audioFile.name,
    })

    return {
        title: metadata.common.title || audioFile.name,
        artist: metadata.common.artist || 'Unknown Artist',
        audioFile: audioFile,
        coverImage: metadata.common.picture ? `data:${metadata.common.picture[0].format};base64,${uint8ArrayToBase64(metadata.common.picture[0].data)}` : undefined,
        isPlaying: false,
    }
}