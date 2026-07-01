import sqs from '../shortQuerySelector';
import { Manager } from '../Manager';
import type { Track } from '../track/Track';
import { bus, updateManager } from '../state/Managers';

export class PlayerManager extends Manager {
    isPlaying = false
    playOnNextTrackLoad = true
    #lyricsSynced = true
    #progressTimeLabel = sqs('#player-label-progress .currentTime')

    controls = {
        playButton: sqs<HTMLButtonElement>('#player-button-play'),
        progressSlider: sqs<HTMLButtonElement>('#player-slider-progress'),
        volumeSlider: sqs<HTMLInputElement>('#player-slider-volume'),
        syncButton: sqs<HTMLButtonElement>('#player-button-sync'),
        playNextButton: sqs<HTMLButtonElement>('#player-button-play-next'),
        shuffleQueue: sqs<HTMLButtonElement>('#player-button-shuffle'),
    }

    audioElement = sqs<HTMLAudioElement>('#audioPlayer')

    Initialize() {
        this.#initHooks()
        this.#initBusListeners()
        this.SetControlsEnabled(false)
    }

    #initBusListeners() {
        bus.on('queue:play-request', ({ track, play }) => {
            this.LoadTrack(track, play)
        })

        bus.on('lyrics:synced', () => {
            this.#lyricsSynced = true
            this.controls.syncButton.disabled = true
        })

        bus.on('lyrics:unsynced', () => {
            this.#lyricsSynced = false
            this.controls.syncButton.disabled = false
        })
    }

    #initHooks() {
        this.audioElement.addEventListener('loadeddata', () => {
            this.SetControlsEnabled(true)

            const minutes = Math.floor(this.audioElement.duration / 60)
            const seconds = Math.floor(this.audioElement.duration % 60).toString().padStart(2, '0')

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

        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true
            this.UpdatePlayButtonState()
            bus.emit('playback:play', {})
        })

        this.audioElement.addEventListener('pause', () => {
            this.isPlaying = false
            this.UpdatePlayButtonState()
            bus.emit('playback:pause', {})
        })

        this.audioElement.addEventListener('ended', () => {
            bus.emit('playback:ended', {})
        })

        this.controls.progressSlider.addEventListener('input', () => {
            this.audioElement.currentTime = Math.min(
                parseFloat(this.controls.progressSlider.value) / 100 * this.audioElement.duration,
                this.audioElement.duration - 0.001,
            )

            if (!this.audioElement.paused)
                this.audioElement.pause()

            bus.emit('playback:seek', {})
        })

        this.controls.syncButton.addEventListener('click', () => {
            bus.emit('lyrics:sync-request', {})
        })

        this.controls.playButton.addEventListener('click', () => {
            if (this.audioElement.paused) {
                if (this.audioElement.readyState === 0)
                    bus.emit('queue:next', {})
                else this.audioElement.play()
            } else this.audioElement.pause()
        })

        this.controls.playNextButton.addEventListener('click', () => {
            bus.emit('queue:next', {})
        })

        this.controls.shuffleQueue.addEventListener('click', () => {
            bus.emit('queue:shuffle', {})
        })

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault()
                this.controls.playButton.click()
            }
        })

        this.SetVolume()
        this.controls.volumeSlider.addEventListener('input', () => this.SetVolume())

        updateManager.AddUpdateListener(() => this.UpdateProgressIndicators())
    }

    SetVolume = (volume: number = parseFloat(this.controls.volumeSlider.value)) => {
        this.audioElement.volume = Math.min(Math.max(volume, 0), 100) / 100
    }

    UpdatePlayButtonState() {
        this.controls.playButton.innerText = this.audioElement.paused ? '▶' : '⏸'
    }

    SetControlsEnabled(enabled?: boolean) {
        console.log(`Player controls ${enabled ? 'enabled' : 'disabled'}.`)

        this.controls.progressSlider.disabled = !enabled
        this.controls.volumeSlider.disabled = !enabled
        this.controls.syncButton.disabled = enabled ? this.#lyricsSynced : false

        this.UpdatePlayButtonState()
    }

    LoadAudioFile(file: File | Blob) {
        if (!file.type.startsWith('audio/')) {
            alert('Invalid audio file.')
            return
        }

        console.log(`Loading audio file`)
        const reader = new FileReader()

        reader.onload = () => {
            this.audioElement.innerHTML = `<source src="${reader.result}" type="${file.type}">`
            this.audioElement.load()

            console.log(`Audio loaded.`)
        }

        reader.readAsDataURL(file)
    }

    LoadTrack(track: Track, playOnLoad: boolean = false) {
        this.playOnNextTrackLoad = playOnLoad
        this.LoadAudioFile(track.audioFile)
        bus.emit('track:loaded', { track })
    }

    SkipCurrentTrack() {
        this.audioElement.querySelectorAll('source').forEach(node => node.remove())
        this.audioElement.removeAttribute('src')
        this.audioElement.load()
    }

    UpdateProgressIndicators() {
        const progress = (this.audioElement.currentTime / this.audioElement.duration) * 100
        this.controls.progressSlider.value = `${progress}`

        const time = (progress / 100) * this.audioElement.duration
        const minutes = Math.floor(time / 60) || '0'
        const seconds = Math.floor(time % 60) || '00'

        this.#progressTimeLabel.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`
    }
}
