import sqs from '../../safeQuerySelector';
import { Manager } from '../Manager';
import type { Track } from '../queue/Track';
import { Managers } from '../state/Managers';

export class PlayerManager extends Manager {
    state = {
        isPlaying: false,
        playOnNextTrackLoad: true,
    }

    controls = {
        playButton: sqs('#player-button-play') as HTMLButtonElement,
        progressSlider: sqs('#player-slider-progress') as HTMLInputElement,
        volumeSlider: sqs('#player-slider-volume') as HTMLInputElement,
        syncButton: sqs('#player-button-sync') as HTMLButtonElement,
        backwardButton: sqs('#player-button-backward') as HTMLButtonElement,
        forwardButton: sqs('#player-button-forward') as HTMLButtonElement,
        playNextButton: sqs('#player-button-play-next') as HTMLButtonElement,
    }

    audioElement = sqs('#audioPlayer') as HTMLAudioElement

    Initialize() {
        this.#initHooks()
        this.SetControlsEnabled(false)
    }

    #initHooks() {
        this.audioElement.addEventListener('loadeddata', () => {
            this.SetControlsEnabled(true)
        
            const minutes = Math.round(this.audioElement.duration / 60)
            const seconds = Math.round(this.audioElement.duration % 60).toString().padStart(2, '0')
        
            // @ts-ignore
            sqs('#player-label-progress .endTime').innerText = `${minutes}:${seconds}`

            if (this.state.playOnNextTrackLoad) {
                this.audioElement.play()
                this.state.playOnNextTrackLoad = false
            }

            this.UpdatePlayButtonState()
        })

        this.audioElement.addEventListener('emptied', () => {
            this.SetControlsEnabled(false)
        })

        sqs('#player-file-audio').addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const file = target.files?.[0]
            if (!file) return

            this.LoadAudioFile(file)
        })

        this.audioElement.addEventListener('play', () => {
            this.state.isPlaying = true
            this.UpdatePlayButtonState()
        })
        this.audioElement.addEventListener('pause', () => {
            this.state.isPlaying = false
            this.UpdatePlayButtonState()
        })

        this.controls.progressSlider.addEventListener('input', () => {
            this.audioElement.currentTime = (parseFloat(this.controls.progressSlider.value) / 100) * this.audioElement.duration
            Managers.LyricsManager.SyncLyrics()
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

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault()
                this.controls.playButton.click()
            }
        })

        this.SetVolume()
        this.controls.volumeSlider.addEventListener('input', () => this.SetVolume())

        Managers.UpdateManager.AddUpdateListener(() => this.UpdateProgressIndicators())
    }

    /**
     * Sets the audio volume.
     * @param volume Optional - Volume ranging from 0 - 100. If not provided, it will use the current value of the volume slider.
     */
    SetVolume = (volume: number = parseFloat(this.controls.volumeSlider.value)) => {
        this.audioElement.volume = Math.min(Math.max(volume, 0), 100) / 100
    }

    UpdatePlayButtonState () {
        this.controls.playButton.innerText = this.audioElement.paused ? '▶' : '❚❚'
    }

    SetControlsEnabled(enabled: boolean) {
        console.log(`Player controls ${enabled ? 'enabled' : 'disabled'}.`)

        this.controls.playButton.disabled = !enabled
        this.controls.progressSlider.disabled = !enabled
        this.controls.volumeSlider.disabled = !enabled
        this.controls.syncButton.disabled = enabled ? Managers.LyricsManager.state.synced : false
    }

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
        this.state.playOnNextTrackLoad = playOnLoad
        this.LoadAudioFile(track.audioFile)

        if (track.lyricsFile)
            Managers.LyricsManager.LoadFromFile(track.lyricsFile)
    }

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