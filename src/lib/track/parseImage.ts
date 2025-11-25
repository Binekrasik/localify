import { parseWebStream } from 'music-metadata';
import { uint8ArrayToBase64 } from 'uint8array-extras';

export async function parseCoverImage(audioFile: File): Promise<string | null> {
    const metadata = await parseWebStream(audioFile.stream(), {
        mimeType: audioFile.type,
        size: audioFile.size,
        path: audioFile.name,
    })

    return !metadata.common.picture || metadata.common.picture.length === 0
        ? null
        : `data:${metadata.common.picture[0].format};base64,${uint8ArrayToBase64(metadata.common.picture[0].data)}`
}