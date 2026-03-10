import { Managers } from "../state/Managers"
import type { RemoteInstance } from "./RemoteInstance"
import type { RemoteTrack } from "./RemoteTrack"

export interface RemoteManifest {
    version: number
    tracks: RemoteTrack[]
}

export const ParseLoadManifestData = async (manifest: RemoteManifest, remoteInstance: RemoteInstance, allowedFormats: string[] | null = null): Promise<void> => {
    const files: File[] = []

    manifest.tracks.forEach(async track => {
        let skip = allowedFormats ? true : false
        if (allowedFormats)
            allowedFormats.forEach(format => {
                if (track.id.toLowerCase().endsWith(format)) {
                    skip = false
                    return
                }
            })

        if (skip) {
            console.log(`Skipping track ${track.id}`)
            return
        }

        console.log(`Fetching track ${track.id}`)
        const trackBlob = await remoteInstance.FetchTrack(track)

        if (!trackBlob) {
            console.warn(`Failed to fetch track with id ${track.id}`)
            return
        }

        if (files.push(new File([trackBlob], `${track.id}`, { type: trackBlob.type })) == manifest.tracks.length) {
            Managers.QueueManager.ProcessAudioAndLyricsFiles(files)
        }
    })
}
