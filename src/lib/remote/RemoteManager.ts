import { RemoteInstance } from "./RemoteInstance"

export class RemoteManager {
    readonly #remotes: RemoteInstance[] = []

    Initialize() {
        // add a temporary development instance
        this.#remotes.push(
            new RemoteInstance(
                `${prompt("Enter the remote server url")}`,
                `${prompt("Enter the remote server secret")}`
            )
        )
    }
}
