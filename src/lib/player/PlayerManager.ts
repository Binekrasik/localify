import sqs from '../shortQuerySelector';
import { Manager } from '../Manager';
import type { Track } from '../track/Track';
import { bus, updateManager } from '../state/Managers';
import { PlayPauseIcon } from './PlayPauseIcon';
import { SeekBar } from './SeekBar';

/** How long loading has to last before the play button and the seek bar show it. */
const loadingIndicatorDelay = 300
/** The cross-fade between the play button's icon and its spinner. Matches $-loadingFade in player.scss. */
const loadingFade = 200

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

    /** The audio element is fetching a track's first frame. */
    #loadPending = false
    /** Playback has run out of data. */
    #stalled = false
    #loadingShown = false
    #loadingTimer: number | null = null
    #spinnerRestTimer = 0

    #progressTimeLabel = sqs('#player-label-progress .currentTime')
    #endTimeLabel = sqs('#player-label-progress .endTime')
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

    #playIcon = new PlayPauseIcon()
    #seekBar = new SeekBar(sqs('#player-progress-bar'), this.controls.progressSlider)

    Initialize() {
        this.controls.playButton.prepend(this.#playIcon.element)

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

        bus.on('track:loaded', ({ track }) => {
            this.#showNowPlaying(track)
            this.#seekBar.enabled = true
        })

        bus.on('track:unloaded', () => {
            this.#showNowPlaying(null)
            this.#seekBar.enabled = false
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
            this.#loadPending = false
            this.SetControlsEnabled(true)

            this.#endTimeLabel.textContent = formatTime(this.audioElement.duration)

            if (this.playOnNextTrackLoad) {
                this.audioElement.play()
                this.playOnNextTrackLoad = false
            } else if (this.isPlaying) {
                // Loading a track stops the one before it without a pause event.
                this.isPlaying = false
                bus.emit('playback:pause', {})
            }

            this.#syncPlaybackState()
        })

        this.audioElement.addEventListener('error', () => {
            this.#loadPending = false
            this.#syncPlaybackState()
        })

        this.audioElement.addEventListener('emptied', () => {
            this.SetControlsEnabled(false)
        })

        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true
            this.#syncPlaybackState()
            bus.emit('playback:play', {})
        })

        this.audioElement.addEventListener('pause', () => {
            this.isPlaying = false
            this.#syncPlaybackState()
            bus.emit('playback:pause', {})
        })

        this.audioElement.addEventListener('ended', () => {
            bus.emit('playback:ended', {})
        })

        this.audioElement.addEventListener('waiting', () => this.#setStalled(true))
        for (const type of ['playing', 'canplay', 'ended', 'emptied'])
            this.audioElement.addEventListener(type, () => this.#setStalled(false))

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
        // A track that is still loading can't play or pause yet, so the click decides whether it starts once loaded.
        if (this.#loadPending) {
            this.playOnNextTrackLoad = !this.playOnNextTrackLoad
            this.#syncPlaybackState()
        } else if (!this.audioElement.paused)
            this.audioElement.pause()
        else if (this.audioElement.readyState === 0)
            bus.emit('queue:next', {})
        else this.audioElement.play()
    }

    #setStalled(stalled: boolean) {
        this.#stalled = stalled
        this.#syncPlaybackState()
    }

    /** Brings the play button and the seek bar's wave in line with the audio element. */
    #syncPlaybackState() {
        const { paused } = this.audioElement
        const { playButton } = this.controls
        const loading = this.#loadPending || (this.#stalled && !paused)
        const pausesOnClick = this.#loadPending ? this.playOnNextTrackLoad : !paused

        playButton.setAttribute('aria-label', pausesOnClick ? 'Pause' : 'Play')
        playButton.setAttribute('aria-busy', String(loading))

        // Loading only shows once it has lasted a while. Until then the controls keep their state,
        // so a quick load takes the icon straight from one state to the next.
        if (loading) {
            if (!this.#loadingShown && this.#loadingTimer === null)
                this.#loadingTimer = window.setTimeout(() => this.#showLoading(), loadingIndicatorDelay)
            return
        }

        if (this.#loadingTimer !== null) {
            window.clearTimeout(this.#loadingTimer)
            this.#loadingTimer = null
        }

        this.#seekBar.playing = !paused

        if (!this.#loadingShown) {
            this.#playIcon.Set(!paused)
            return
        }

        // Under the spinner the icon changes unseen. The two cross-fade, and the spinner turns until it is gone.
        this.#playIcon.Set(!paused, false)
        this.#loadingShown = false
        playButton.dataset.loading = 'fading'
        this.#spinnerRestTimer = window.setTimeout(() => playButton.dataset.loading = 'false', loadingFade)
    }

    #showLoading() {
        window.clearTimeout(this.#spinnerRestTimer)
        this.#loadingTimer = null
        this.#loadingShown = true
        this.controls.playButton.dataset.loading = 'true'
        this.#seekBar.playing = false
    }

    SetControlsEnabled(enabled?: boolean) {
        console.log(`Player controls ${enabled ? 'enabled' : 'disabled'}.`)

        this.controls.progressSlider.disabled = !enabled
        this.controls.syncButton.disabled = enabled ? this.#lyricsSynced : false
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
        this.#loadPending = true
        this.#syncPlaybackState()
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
        this.#loadPending = false
        this.#stalled = false
        this.SetControlsEnabled(false)
        this.#syncPlaybackState()
        this.#endTimeLabel.textContent = '0:00'
        bus.emit('track:unloaded', {})
    }

    UpdateProgressIndicators() {
        const { currentTime, duration } = this.audioElement
        const ratio = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0
        const progress = Math.min(Math.max(ratio * 100, 0), 100)

        this.#seekBar.Update(progress / 100, currentTime)

        if (progress === this.#lastProgress) return
        this.#lastProgress = progress

        this.controls.progressSlider.value = `${progress}`
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
