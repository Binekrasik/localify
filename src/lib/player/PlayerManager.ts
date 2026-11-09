import sqs from '../shortQuerySelector';
import { Manager } from '../Manager';
import type { Track } from '../track/Track';
import { bus, updateManager } from '../state/Managers';

function formatTime(totalSeconds: number): string {
    const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(totalSeconds, 0) : 0
    const minutes = Math.floor(safeSeconds / 60)
    const seconds = Math.floor(safeSeconds % 60).toString().padStart(2, '0')

    return `${minutes}:${seconds}`
}

export class PlayerManager extends Manager {
    isPlaying = false
    playOnNextTrackLoad = true
    #lyricsSynced = true
    #lastProgress = 0
    #progressTimeLabel = sqs('#player-label-progress .currentTime')
    #endTimeLabel = sqs('#player-label-progress .endTime')
    #progressBar = sqs('#player-progress-bar')
    #nowPlaying = sqs('#player-now-playing')
    #coverImage = sqs<HTMLImageElement>('#player-cover')
    #titleLabel = sqs('#player-title')
    #artistLabel = sqs('#player-artist')

    controls = {
        playButton: sqs<HTMLButtonElement>('#player-button-play'),
        progressSlider: sqs<HTMLInputElement>('#player-slider-progress'),
        volumeSlider: sqs<HTMLInputElement>('#player-slider-volume'),
        syncButton: sqs<HTMLButtonElement>('#player-button-sync'),
        playNextButton: sqs<HTMLButtonElement>('#player-button-play-next'),
        previousButton: sqs<HTMLButtonElement>('#player-button-previous'),
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

        bus.on('queue:history-changed', ({ hasHistory }) => {
            this.controls.previousButton.disabled = !hasHistory
        })

        bus.on('track:loaded', ({ track }) => this.#showNowPlaying(track))
        bus.on('track:unloaded', () => this.#showNowPlaying(null))

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

            this.#endTimeLabel.textContent = formatTime(this.audioElement.duration)

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

            if (this.audioElement.currentTime === this.audioElement.duration - 0.001)
                if (!this.audioElement.paused)
                    this.audioElement.pause()

            bus.emit('playback:seek', {})
        })

        this.controls.syncButton.addEventListener('click', () => {
            bus.emit('lyrics:sync-request', {})
        })

        this.controls.playButton.addEventListener('click', () => this.TogglePlayback())

        this.controls.playNextButton.addEventListener('click', () => {
            bus.emit('queue:next', {})
        })

        this.controls.previousButton.addEventListener('click', () => {
            bus.emit('queue:previous', {})
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
        const clampedVolume = Math.min(Math.max(volume, 0), 100)

        this.audioElement.volume = clampedVolume / 100
        this.controls.volumeSlider.style.setProperty('--volume', `${clampedVolume}%`)
    }

    TogglePlayback() {
        if (this.audioElement.paused) {
            if (this.audioElement.readyState === 0)
                bus.emit('queue:next', {})
            else this.audioElement.play()
        } else this.audioElement.pause()
    }

    UpdatePlayButtonState() {
        const { paused } = this.audioElement

        this.controls.playButton.dataset.playing = String(!paused)
        this.controls.playButton.setAttribute('aria-label', paused ? 'Play' : 'Pause')
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

        const oldSrc = this.audioElement.src
        this.audioElement.src = URL.createObjectURL(file)

        if (oldSrc.startsWith('blob:'))
            URL.revokeObjectURL(oldSrc)

        this.audioElement.load()
    }

    LoadTrack(track: Track, playOnLoad: boolean = false) {
        this.playOnNextTrackLoad = playOnLoad
        this.LoadAudioFile(track.audioFile)
        bus.emit('track:loaded', { track })
    }

    SkipCurrentTrack() {
        this.playOnNextTrackLoad = false
        this.audioElement.pause()
        this.isPlaying = false
        const oldSrc = this.audioElement.src
        this.audioElement.removeAttribute('src')
        if (oldSrc.startsWith('blob:'))
            URL.revokeObjectURL(oldSrc)
        this.audioElement.load()
        this.SetControlsEnabled(false)
        this.#endTimeLabel.textContent = '0:00'
        bus.emit('track:unloaded', {})
    }

    UpdateProgressIndicators() {
        const { currentTime, duration } = this.audioElement
        const ratio = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0
        const progress = Math.min(Math.max(ratio * 100, 0), 100)

        if (progress === this.#lastProgress) return
        this.#lastProgress = progress

        this.controls.progressSlider.value = `${progress}`
        this.#progressBar.style.setProperty('--progress', `${progress}%`)
        this.#progressTimeLabel.textContent = formatTime(currentTime)
    }

    #showNowPlaying(track: Track | null) {
        this.#titleLabel.textContent = track?.title ?? ''
        this.#artistLabel.textContent = track?.artist ?? ''
        this.#nowPlaying.dataset.empty = String(!track)

        if (track?.coverImage) {
            this.#coverImage.src = track.coverImage
            this.#coverImage.hidden = false
        } else {
            this.#coverImage.removeAttribute('src')
            this.#coverImage.hidden = true
        }
    }
}
