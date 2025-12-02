import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import type { Track } from '../track/Track'
import { parseAudioFile } from '../track/parseAudioFile'
import { readLrcFile } from '../lyrics/lrcutils'

export class QueueManager extends Manager {
    queue: Track[] = []
    #queueListElement = sqs('#queue') as HTMLDivElement
    #addToQueueInput = sqs('#player-add-to-queue') as HTMLInputElement

    Initialize() {
        // this.#queueListElement.innerHTML = ''
        this.#initHooks()
    }

    #initHooks() {
        this.#addToQueueInput.addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const files = target.files
            if (!files || files.length < 1) return

            [...files]
                .filter(file => file.type.startsWith('audio/'))
                .forEach(audioFile => {
                    const match = audioFile.name.toLowerCase().match(/(.*)\.[^.]+$/)
                    if (!match) return false

                    const lyricsFile = [...files]
                        .find(file => {
                            console.log('Comparing', file.name.toLowerCase(), 'with', match[1])

                            return file.name
                                .toLowerCase()
                                .includes(match[1])
                                && file.name.toLowerCase().endsWith('.lrc')
                        })

                    if (lyricsFile) {
                        new Promise(async (resolve, reject) => {
                            const track = await parseAudioFile(audioFile)
                            readLrcFile(lyricsFile).then(text => {
                                this.AddToQueue({ ...track, lyrics: text })
                                console.log('Track added!')

                                resolve(undefined)
                            }).catch(() => reject())
                        }).catch(() => {
                            console.warn(`Failed to add track ${audioFile.name}.`)
                        })
                    }
                })

            // reset the input value to allow adding the same files again if needed
            this.#addToQueueInput.value = ''
        })

        new MutationObserver(mutationList => {
            mutationList.forEach(mutation => {
                if (mutation.type !== 'childList') return

                if (this.#queueListElement.querySelectorAll('.queueItem').length === 0)
                    sqs('#queueContainer .queueEmptyIndicator').removeAttribute('data-hidden')
                else sqs('#queueContainer .queueEmptyIndicator').setAttribute('data-hidden', 'true')
            })
        }).observe(this.#queueListElement, { childList: true })
    }

    AddToQueue(track: Track) {
        const trackElement = document.createElement('div')
        trackElement.classList.add('queueItem')
        trackElement.setAttribute('data-playing', track.isPlaying ? 'true' : 'false')
        trackElement.innerHTML = `
            <img src="${track.coverImage ? track.coverImage : ''}" alt="No image" >
            <div class="trackInfo">
                <p class="name">${track.title}</p>
                <p class="lyricsStatus" data-loaded="${track.lyrics ? 'true' : 'false'}">${track.lyrics ? 'lyrics loaded' : 'no lyrics'}</p>
            </div>
        `

        const contextMenuElement = document.createElement('div')
        contextMenuElement.classList.add('contextMenu')
        contextMenuElement.setAttribute('data-visible', 'false')
        contextMenuElement.innerHTML = `
            <button>play</button>
            <button>remove</button>
        `

        trackElement.appendChild(contextMenuElement)
        this.#queueListElement.appendChild(trackElement)

        const itemRightclickListener = (event: MouseEvent) => {
            console.log('click!')

            // exit the menu if the user clicked outside
            const dismissMenuListener = (ev: MouseEvent) => {
                if (contextMenuElement.getAttribute('data-visible') !== 'true') return

                // do not exit if the click was made inside the context menu
                const boundingBox = contextMenuElement.getBoundingClientRect()

                console.group('menu boundaries')
                console.debug(`menuX: ${boundingBox.left}, menuRightX: ${boundingBox.right}`)
                console.debug(`menuY: ${boundingBox.top}, menuLowerY: ${boundingBox.bottom}`)
                console.debug(`mouseX: ${ev.x}, mouseY: ${ev.y}`)
                console.groupEnd()

                if (
                    ev.x >= boundingBox.left && ev.x <= boundingBox.right
                    && ev.y >= boundingBox.top && ev.y <= boundingBox.bottom
                ) return

                document.removeEventListener('click', dismissMenuListener)
                contextMenuElement.setAttribute('data-visible', 'false')

                ev.preventDefault()
            }

            document.addEventListener('contextmenu', dismissMenuListener)

            contextMenuElement.setAttribute('data-visible', 'true')
            contextMenuElement.style.top = `${event.y}px`
            contextMenuElement.style.left = `${event.x}px`

            event.preventDefault()
        }

        trackElement.addEventListener('contextmenu', itemRightclickListener)

        this.queue.push({ ...track, domElement: trackElement })
    }

    PlayCurrentTrack() {
        const track = this.queue[0]
        if (!track) return

        Managers.PlayerManager.LoadTrack(track, true)
        this.#queueListElement.querySelectorAll('.queueItem')[0].setAttribute('data-playing', 'true')
    }

    RemoveTrackElement(element: HTMLElement) {
        element.setAttribute('data-removed', 'true')
        element.style.top = `${element.offsetTop}px`
        element.style.left = `${element.offsetLeft}px`
        element.style.position = 'absolute'

        Managers.UpdateManager.CreateTimer({
            callback: () => { element.remove() },
            delay: 300,
        })
    }

    PlayNextTrack() {
        console.log('Playing next track in queue.')

        Managers.LyricsManager.ResetLyrics()
        Managers.PlayerManager.SkipCurrentTrack()

        if (this.queue.length > 0)
            if (this.queue[0].isPlaying) {
                const removed = this.queue.shift()
                this.RemoveTrackElement(removed?.domElement!)
            }

        if (this.queue.length === 0) return

        this.queue[0].isPlaying = true
        this.queue[0].domElement!.setAttribute('data-playing', 'true')
        Managers.PlayerManager.LoadTrack(this.queue[0], true)
    }
}