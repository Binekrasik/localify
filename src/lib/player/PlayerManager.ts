import sqs from '../shortQuerySelector';
import { Manager } from '../Manager';
import type { Track } from '../track/Track';
import { Managers } from '../state/Managers';

export class PlayerManager extends Manager {
    isPlaying = false
    playOnNextTrackLoad = true

    controls = {
        playButton: sqs<HTMLButtonElement>('#player-button-play'),
        progressSlider: sqs<HTMLButtonElement>('#player-slider-progress'),
        volumeSlider: sqs<HTMLInputElement>('#player-slider-volume'),
        syncButton: sqs<HTMLButtonElement>('#player-button-sync'),
        backwardButton: sqs<HTMLButtonElement>('#player-button-backward'),
        forwardButton: sqs<HTMLButtonElement>('#player-button-forward'),
        playNextButton: sqs<HTMLButtonElement>('#player-button-play-next'),
        toggleZenMode: sqs<HTMLButtonElement>('#player-button-zen'),
    }

    audioElement = sqs<HTMLAudioElement>('#audioPlayer')

    Initialize() {
        this.#initHooks()
        this.SetControlsEnabled(false)
    }

    #initHooks() {
        //
        // Audio stuff
        this.audioElement.addEventListener('loadeddata', () => {
            this.SetControlsEnabled(true)

            const minutes = Math.floor(this.audioElement.duration / 60)
            const seconds = Math.floor(this.audioElement.duration % 60).toString().padStart(2, '0')

            // @ts-ignore
            sqs('#player-label-progress .endTime').innerText = `${minutes}:${seconds}`

            if (this.playOnNextTrackLoad) {
                this.audioElement.play()
                this.playOnNextTrackLoad = false
            }

            this.UpdatePlayButtonState()
        })

        this.audioElement.addEventListener('emptied', () => {
            this.SetControlsEnabled(false)
        })

        /* sqs('#player-file-audio').addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const file = target.files?.[0]
            if (!file) return

            this.LoadAudioFile(file)
        }) */

        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true
            this.UpdatePlayButtonState()

            Managers.UpdateManager.CreateTimer({
                callback: () => Managers.LyricsManager.UpdateLyricsPositionIndicator(),
                delay: 50,
            })
        })

        this.audioElement.addEventListener('pause', () => {
            this.isPlaying = false
            this.UpdatePlayButtonState()
        })

        this.audioElement.addEventListener('ended', () => {
            Managers.QueueManager.PlayNextTrack()
        })

        //
        // Controls
        this.controls.progressSlider.addEventListener('input', () => {
            this.audioElement.currentTime = (parseFloat(this.controls.progressSlider.value) / 100) * this.audioElement.duration
            Managers.LyricsManager.SyncLyrics()
            Managers.LyricsManager.UpdateLyricsPositionIndicator(true)
        })

        this.controls.syncButton.addEventListener('click', () => Managers.LyricsManager.SyncLyrics())
        this.controls.playButton.addEventListener('click', () => {
            if (this.audioElement.paused) {
                this.audioElement.play()
            } else this.audioElement.pause()
        })

        this.controls.backwardButton.addEventListener('click', () => Managers.LyricsManager.SyncLyrics())
        this.controls.backwardButton.addEventListener('click', () => {
            this.audioElement.currentTime = Math.max(this.audioElement.currentTime - 1, 0)
        })

        this.controls.forwardButton.addEventListener('click', () => Managers.LyricsManager.SyncLyrics())
        this.controls.forwardButton.addEventListener('click', () => {
            this.audioElement.currentTime = Math.min(this.audioElement.currentTime + 1, this.audioElement.duration)
        })

        this.controls.playNextButton.addEventListener('click', () => {
            Managers.QueueManager.PlayNextTrack()
        })

        // zen mode
        this.controls.toggleZenMode.addEventListener('click', () => this.ToggleZenMode())

        // spacebar play/pause
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault()
                this.controls.playButton.click()
            }
        })

        // volume
        this.SetVolume()
        this.controls.volumeSlider.addEventListener('input', () => this.SetVolume())

        // progress updating
        Managers.UpdateManager.AddUpdateListener(() => this.UpdateProgressIndicators())
    }

    ToggleZenMode(enable?: boolean) {
        const app = sqs('#app')

        if (app.getAttribute('data-zen') === 'true' && typeof enable === 'undefined' || !enable && typeof enable !== 'undefined') {
            app.setAttribute('data-zen', 'false')

            sqs('#queueContainer').removeAttribute('data-collapsable')
            sqs('#player').removeAttribute('data-collapsable')

            document.exitFullscreen()
        } else {
            app.setAttribute('data-zen', 'true')

            sqs('#queueContainer').setAttribute('data-collapsable', 'true')
            sqs('#player').setAttribute('data-collapsable', 'true')

            sqs('html').requestFullscreen()
        }
    }

    /**
     * Sets the audio volume.
     * @param volume Optional - Volume ranging from 0 - 100. If not provided, it will use the current value of the volume slider.
     */
    SetVolume = (volume: number = parseFloat(this.controls.volumeSlider.value)) => {
        this.audioElement.volume = Math.min(Math.max(volume, 0), 100) / 100
    }

    /**
     * Sets the play button icon based on whether the audio is playing or paused.
     */
    UpdatePlayButtonState () {
        this.controls.playButton.innerText = this.audioElement.paused ? '▶' : '⏸'
    }

    /**
     * Enabled or disables player controls.
     * @param enabled
     */
    SetControlsEnabled(enabled?: boolean) {
        console.log(`Player controls ${enabled ? 'enabled' : 'disabled'}.`)

        this.controls.playButton.disabled = !enabled
        this.controls.progressSlider.disabled = !enabled
        this.controls.volumeSlider.disabled = !enabled
        this.controls.syncButton.disabled = enabled ? Managers.LyricsManager.state.synced : false

        this.UpdatePlayButtonState()
    }

    /**
     * Loads an audio file into the audio element using <source ...>.
     * @param file the audio file to load
     */
    LoadAudioFile (file: File) {
        if (!file.type.startsWith('audio/')) {
            alert('Invalid audio file.')
            return
        }

        console.log(`Loading audio file: ${file.name}`)
        const reader = new FileReader()

        reader.onload = () => {
            this.audioElement.innerHTML = `<source src="${reader.result}" type="${file.type}">`
            this.audioElement.load()

            console.log(`${file.name} loaded.`)
        }

        reader.readAsDataURL(file)
    }

    LoadTrack (track: Track, playOnLoad: boolean = false) {
        this.playOnNextTrackLoad = playOnLoad
        this.LoadAudioFile(track.audioFile)

        Managers.LyricsManager.LoadFromTrack(track)
    }

    SkipCurrentTrack() {
        this.audioElement.querySelectorAll('source').forEach(node => node.remove())
        this.audioElement.removeAttribute('src')
        this.audioElement.load()
    }

    /** */
    UpdateProgressIndicators () {
        const progress = (this.audioElement.currentTime / this.audioElement.duration) * 100
        this.controls.progressSlider.value = `${progress}`

        const time = (progress / 100) * this.audioElement.duration
        const minutes = Math.floor(time / 60) || '0'
        const seconds = Math.floor(time % 60) || '00'

        // @ts-ignore
        sqs('#player-label-progress .currentTime').innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`
    }
}
