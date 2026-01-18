import sqs from "../shortQuerySelector"
import { Manager } from "../Manager"
import { Managers } from "../state/Managers"
import type { Track } from "../track/Track"
import { parseAudioFile } from "../track/parseAudioFile"
import { readLrcFile } from "../lyrics/lrcutils"

export class QueueManager extends Manager {
    queue: Track[] = []
    #queueListElement = sqs("#queue") as HTMLDivElement
    #addToQueueInput = sqs("#player-add-to-queue") as HTMLInputElement

    Initialize() {
        // this.#queueListElement.innerHTML = ''
        this.#initHooks()
        // this.AddInitialTrackElement({} as Track)
    }

    #initHooks() {
        this.#addToQueueInput.addEventListener("change", (event) => {
            const target = event.target as HTMLInputElement
            const files = target.files
            if (!files || files.length < 1) return

            const filesArray = [...files]
            filesArray
                .filter((file) => file.type.startsWith("audio/"))
                .forEach((audioFile) => {
                    const initialTrack = {} as Track
                    this.AddInitialTrackElement(initialTrack)

                    const match = audioFile.name
                        .toLowerCase()
                        .match(/(.*)\.[^.]+$/)
                    if (!match) return false

                    const lyricsFile = [...files].find((file) => {
                        console.log(
                            "Comparing",
                            file.name.toLowerCase(),
                            "with",
                            match[1],
                        )

                        return (
                            file.name.toLowerCase().includes(match[1]) &&
                            file.name.toLowerCase().endsWith(".lrc")
                        )
                    })

                    this.AddTrackFromFile(audioFile, lyricsFile, initialTrack)
                })

            // reset the input value to allow adding the same files again if needed
            this.#addToQueueInput.value = ""
        })

        new MutationObserver((mutationList) => {
            mutationList.forEach((mutation) => {
                if (mutation.type !== "childList") return

                if (this.#queueListElement.querySelectorAll(".queueItem").length === 0)
                    sqs("#queueContainer .queueEmptyIndicator").removeAttribute("data-hidden")
                else
                    sqs("#queueContainer .queueEmptyIndicator").setAttribute("data-hidden", "true")
            })
        }).observe(this.#queueListElement, { childList: true })
    }

    AddTrackFromFile(audioFile: File, lyricsFile?: File, initialTrack?: Track) {
        new Promise<void>(async (resolve, _reject) => {
            let track = await parseAudioFile(audioFile)

            if (initialTrack?.domElement)
                track.domElement = initialTrack.domElement

            let text: string | undefined
            if (lyricsFile) {
                try {
                    text = await readLrcFile(lyricsFile)
                } catch (exception) {
                    console.warn(`Failed to load lyrics for track ${track.title}`)
                    // continue without lyrics
                }
            }

            this.AddToQueue({ ...track, lyrics: text })
            console.log("Track added!")

            resolve()
        }).catch(() => {
            console.warn(`Failed to add track ${audioFile.name}.`)
        })
    }

    AddInitialTrackElement(track: Track) {
        const element = document.createElement("div")
        element.classList.add("queueItem")
        element.innerHTML = `
            <img src="/assets/loader.svg" class="loader">
            <div class="trackInfo">
                <p class="name" data-loading="true"><span>loading some weird track</span></p>
                <p class="lyricsStatus" data-loading="true"><span>loading lyrics</span></p>
            </div>
        `

        this.#queueListElement.appendChild(element)
        track.domElement = element
    }

    AddToQueue(track: Track) {
        const trackElement = track.domElement || document.createElement("div")

        trackElement.classList.add("queueItem")
        trackElement.setAttribute(
            "data-playing",
            track.isPlaying ? "true" : "false",
        )

        trackElement.innerHTML = `
            <img src="${track.coverImage || ""}" alt="No image" >
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="lyricsStatus" data-loaded="${Boolean(track.lyrics)}">${track.lyrics ? "lyrics loaded" : "no lyrics"}</p>
            </div>
        `

        trackElement.addEventListener('mousedown', event => {
            if (event.button != 2)
                return

            const first = document.createElement('p')
            first.innerText = 'Move to the top'
            const firstIcon = document.createElement('img')
            firstIcon.src = '/assets/icons/keyboard_double_arrow_up.svg'

            const second = document.createElement('p')
            second.innerText = 'Move up'
            const secondIcon = document.createElement('img')
            secondIcon.src = '/assets/icons/arrow_upward.svg'

            const third = document.createElement('p')
            third.innerText = 'Move down'
            const thirdIcon = document.createElement('img')
            thirdIcon.src = '/assets/icons/arrow_downward.svg'

            const fourth = document.createElement('p')
            fourth.innerText = 'Remove from queue'
            const fourthIcon = document.createElement('img')
            fourthIcon.src = '/assets/icons/delete.svg'

            Managers.ContextMenuManager.PopulateContextMenu([
                {
                    icon: firstIcon,
                    text: first,
                    onClick: event => {
                        alert('Moved to top')
                    }
                },
                {
                    icon: secondIcon,
                    text: second,
                    onClick: event => {
                        alert('Moved up')
                    }
                },
                {
                    icon: thirdIcon,
                    text: third,
                    onClick: event => {
                        alert('Moved down')
                    }
                },
                {
                    icon: fourthIcon,
                    text: fourth,
                    onClick: event => {
                        alert('Removed')
                    }
                },
            ])

            Managers.ContextMenuManager.ShowContextMenu(event.clientX, event.clientY)
        })

        this.#queueListElement.appendChild(trackElement)
        this.queue.push({ ...track, domElement: trackElement })
    }

    PlayCurrentTrack() {
        const track = this.queue[0]
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement
            .querySelectorAll(".queueItem")[0]
            .setAttribute("data-playing", "true")
    }

    RemoveTrackElement(element: HTMLElement) {
        element.setAttribute("data-removed", "true")
        element.style.top = `${element.offsetTop}px`
        element.style.left = `${element.offsetLeft}px`
        element.style.position = "absolute"

        Managers.UpdateManager.CreateTimer({
            callback: () => element.remove(),
            delay: 300,
        })
    }

    PlayNextTrack() {
        console.log("Playing next track in queue.")

        Managers.LyricsManager.ResetLyrics()
        Managers.PlayerManager.SkipCurrentTrack()

        if (this.queue.length > 0)
            if (this.queue[0].isPlaying) {
                const removed = this.queue.shift()
                this.RemoveTrackElement(removed?.domElement!)
            }

        if (this.queue.length === 0) return

        this.queue[0].isPlaying = true
        this.queue[0].domElement!.setAttribute("data-playing", "true")
        Managers.PlayerManager.LoadTrack(this.queue[0], true)
    }
}
