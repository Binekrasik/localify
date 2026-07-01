import { Managers } from "../state/Managers"
import type { RemoteInstance } from "./RemoteInstance"
import type { RemoteTrack } from "./RemoteTrack"

export interface RemoteManifest {
    version: number
    tracks: RemoteTrack[]
}

export const ParseLoadManifestData = async (manifest: RemoteManifest, remoteInstance: RemoteInstance, allowedFormats: string[] | null = null): Promise<void> => {
    const files: File[] = []

    for (const track of manifest.tracks) {
        if (allowedFormats && !allowedFormats.some(format => track.id.toLowerCase().endsWith(format))) {
            console.log(`Skipping track ${track.id}`)
            continue
        }

        console.log(`Fetching track ${track.id}`)
        const trackBlob = await remoteInstance.FetchTrack(track)

        if (!trackBlob) {
            console.warn(`Failed to fetch track with id ${track.id}`)
            continue
        }

        files.push(new File([trackBlob], `${track.id}`, { type: trackBlob.type }))
    }

    if (files.length > 0)
        Managers.QueueManager.ProcessAudioAndLyricsFiles(files)
}
