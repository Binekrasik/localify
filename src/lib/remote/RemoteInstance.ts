import sqs from "../shortQuerySelector"
import { ParseLoadManifestData, type RemoteManifest } from "./RemoteManifest"
import type { RemoteTrack } from "./RemoteTrack"

export class RemoteInstance {
    #url: string
    #cachedToken: string = ""
    #tokenExpiryDate: Date = new Date(0)
    #secret: string = ""

    constructor(url: string, secret: string) {
        this.#url = url
        this.#secret = secret

        // temporary song loading mechanism
        const button = sqs<HTMLButtonElement>("#remote-instance-fetch")
        button.addEventListener("click", _ => {
            this.FetchManifest().then(data => {
                if (!data) {
                    alert("Failed to load remote manifest")
                    return
                }

                console.log(data)
                console.log("Parsing manifest data")

                ParseLoadManifestData(data, this)
            })
        })
    }

    RemoteUrl(): string {
        return this.#url
    }

    /// fetches the selected track ogg file. Returns a Blob if ok, otherwise returns null
    async FetchTrack(track: RemoteTrack): Promise<Blob | null> {
        await this.RefreshToken()

        const response = await fetch(`${this.#url}/track/${track.id}`, {
            method: 'GET',
            headers: {
                Authorization: this.#cachedToken,
            },
        })

        if (response.ok)
            return await response.blob()

        return null
    }

    /// fetches the manifest from the remote server. Returns a RemoteManifest object if ok, otherwise returns null
    async FetchManifest(): Promise<RemoteManifest | null> {
        await this.RefreshToken()

        const response = await fetch(`${this.#url}/manifest.json`, {
            method: 'POST',
            headers: {
                Authorization: this.#cachedToken,
            }
        })

        if (response.ok)
            return (await response.json()) as RemoteManifest

        return null
    }

    /// checks if the stored or provided token is usable
    async VerifyToken(token: string = ""): Promise<boolean> {
        const response = await fetch(`${this.#url}/token/verify`, {
            method: 'POST',
            headers: {
                Authorization: token,
            }
        })

        return response.ok
    }

    /// tries to fetch a new token with the stored or provided secret. Returns true if everything went ok, false otherwise
    async RefreshToken(secret: string = this.#secret): Promise<boolean> {
        if (new Date() >= this.#tokenExpiryDate) {
            console.log("Refreshing the token")
        } else {
            console.log("The token should be fine")
            return true
        }

        const response = await fetch(`${this.#url}/token`, {
            method: 'POST',
            headers: {
                Authorization: secret,
            }
        })

        if (response.ok) {
            const data = await response.json()
            this.#cachedToken = data.token
            this.#tokenExpiryDate = new Date(data.expiresAfter)

            return true
        }

        return false
    }
}
