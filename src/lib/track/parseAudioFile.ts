import { parseWebStream } from "music-metadata"
import { uint8ArrayToBase64 } from "uint8array-extras"
import type { Track } from "./Track"
import { getAccentColorFromBase64, resizeBase64Image } from "../imageutils"

export async function parseAudioFile(audioFile: File): Promise<Track> {
    const metadata = await parseWebStream(audioFile.stream(), {
        mimeType: audioFile.type,
        size: audioFile.size,
        path: audioFile instanceof File ? audioFile.name : undefined,
    })

    const fullImage = metadata.common.picture ? `data:${metadata.common.picture[0].format};base64,${uint8ArrayToBase64(metadata.common.picture[0].data)}` : undefined

    const coverImage =
        fullImage ? await resizeBase64Image(
            fullImage, 50, 50,
        ) : undefined

    let accentColor: string | undefined

    accentColor = coverImage
        ? await getAccentColorFromBase64(coverImage)
        : "#7050fd"

    const splitName = audioFile.name.split('.')

    return {
        title: metadata.common.title || audioFile.name || "Unknown Title",
        artist: metadata.common.artist || "Unknown Artist",
        audioFile: audioFile,
        coverImage: coverImage,
        fullCoverImage: fullImage,
        isPlaying: false,
        accentColor: accentColor,
        format: splitName[splitName.length - 1]
    }
}

/* return new Promise<Track>(async (resolve, reject) => {
    const metadata = await parseWebStream(audioFile.stream(), {
        mimeType: audioFile.type,
        size: audioFile.size,
        path: audioFile.name,
    })

    const coverImage = metadata.common.picture
        ? await resizeBase64Image(
              `data:${metadata.common.picture[0].format};base64,${uint8ArrayToBase64(metadata.common.picture[0].data)}`,
              50,
              50,
          )
        : undefined

    let accentColor: string | undefined

    accentColor = coverImage
        ? await getAccentColorFromBase64(coverImage)
        : "#7050fd"

    resolve({
        title: metadata.common.title || audioFile.name || "Unknown Title",
        artist: metadata.common.artist || "Unknown Artist",
        audioFile: audioFile,
        coverImage: coverImage,
        isPlaying: false,
        accentColor: accentColor,
    })
    }) */
