import { cubicBezier, pathEasing, reducedMotion, type Easing } from '../motion'

// The geometry and timing of the media seek bar in Android 16's SystemUI (SquigglyProgress and
// SeekBarObserver), with one dp taken as one CSS pixel. Stroke widths and colours are in player.scss.
const wavelength = 20
const amplitude = 1.5
/** Pixels the wave travels towards the start of the bar each second. */
const waveSpeed = 8

const rise = { delay: 60, duration: 800, easing: cubicBezier(0.05, 0.7, 0.1, 1) }
const fall = { delay: 0, duration: 550, easing: cubicBezier(0, 0, 0, 1) }

/** A jump back to the start of a track from later than `threshold` seconds sweeps there instead. */
const rewind = {
    threshold: 0.25,
    duration: 750,
    easing: pathEasing(
        [[0.05, 0], [0.133333, 0.06], [0.166666, 0.4]],
        [[0.208333, 0.82], [0.25, 1], [1, 1]],
    ),
}

function setAttribute(element: Element, name: string, value: number | string) {
    const text = typeof value === 'number' ? String(Math.round(value * 100) / 100) : value
    if (element.getAttribute(name) !== text) element.setAttribute(name, text)
}

/**
 * Draws the seek bar: a wave over the elapsed part, a flat line over the rest and a handle between them.
 * The wave travels while the track plays and settles into a line when playback stops or the user scrubs.
 */
export class SeekBar {
    #root: HTMLElement
    #remaining: SVGLineElement
    #elapsed: SVGSVGElement
    #wave: SVGPathElement
    #startCap: SVGCircleElement

    #width = 0
    #centerY = 0

    #enabled = false
    #playing = false
    #scrubbing = false

    /** Whether the wave travels and stands at full height. */
    #waving = false
    /** The wave's share of its full amplitude. */
    #height = 0
    #heightTween: { from: number; to: number; start: number; duration: number; easing: Easing } | null = null
    #phase = 0
    #lastFrame = performance.now()

    /** The progress on screen, which trails the real one during a rewind. */
    #fraction = 0
    #seconds = 0
    #rewind: { from: number; start: number } | null = null

    #drawnWave = ''
    #drawnHandle = ''

    constructor(root: HTMLElement, input: HTMLInputElement) {
        this.#root = root
        this.#remaining = root.querySelector('.remaining')!
        this.#elapsed = root.querySelector('.elapsed')!
        this.#wave = root.querySelector('.wave')!
        this.#startCap = root.querySelector('.startCap')!

        new ResizeObserver(() => this.#measure()).observe(root)
        this.#measure()
        this.#draw()

        input.addEventListener('pointerdown', () => this.#setScrubbing(true))
        window.addEventListener('pointerup', () => this.#setScrubbing(false))
        window.addEventListener('pointercancel', () => this.#setScrubbing(false))
    }

    /** Whether a track is loaded. Without one the bar is a dim line with no handle. */
    set enabled(enabled: boolean) {
        this.#enabled = enabled
        this.#root.dataset.enabled = String(enabled)
        this.#syncWaving()
    }

    set playing(playing: boolean) {
        this.#playing = playing
        this.#syncWaving()
    }

    /** Draws one frame at the given playback position. */
    Update(fraction: number, seconds: number) {
        const now = performance.now()
        const still = reducedMotion.matches

        if (this.#waving && !still)
            this.#phase = (this.#phase + (now - this.#lastFrame) / 1000 * waveSpeed) % wavelength
        this.#lastFrame = now

        this.#advanceHeight(now, still)
        this.#advanceProgress(fraction, seconds, now, still)
        this.#draw()
    }

    #measure() {
        this.#width = this.#root.clientWidth
        this.#centerY = this.#root.clientHeight / 2
    }

    #setScrubbing(scrubbing: boolean) {
        this.#scrubbing = scrubbing
        this.#syncWaving()
    }

    #syncWaving() {
        const waving = this.#enabled && this.#playing && !this.#scrubbing
        if (waving === this.#waving) return
        this.#waving = waving

        const { delay, duration, easing } = waving ? rise : fall
        this.#heightTween = {
            from: this.#height,
            to: waving ? 1 : 0,
            start: performance.now() + delay,
            duration,
            easing,
        }
    }

    #advanceHeight(now: number, still: boolean) {
        const tween = this.#heightTween
        if (!tween) return

        const progress = still ? 1 : (now - tween.start) / tween.duration
        this.#height = tween.from + (tween.to - tween.from) * tween.easing(progress)
        if (progress >= 1) this.#heightTween = null
    }

    #advanceProgress(fraction: number, seconds: number, now: number, still: boolean) {
        if (this.#scrubbing || still)
            this.#rewind = null
        else if (!this.#rewind && seconds <= rewind.threshold && this.#seconds > rewind.threshold)
            this.#rewind = { from: this.#fraction, start: now }
        this.#seconds = seconds

        if (!this.#rewind) {
            this.#fraction = fraction
            return
        }

        // The sweep aims at the live position, so it lands on a track that keeps playing meanwhile.
        const progress = (now - this.#rewind.start) / rewind.duration
        this.#fraction = this.#rewind.from + (fraction - this.#rewind.from) * rewind.easing(progress)
        if (progress >= 1) this.#rewind = null
    }

    #draw() {
        const width = this.#width
        if (width === 0) return

        const centerY = this.#centerY
        const waveHeight = this.#height * amplitude
        const position = this.#fraction * width

        const waveKey = `${width} ${centerY} ${waveHeight.toFixed(3)}`
        if (waveKey !== this.#drawnWave) {
            this.#drawnWave = waveKey
            this.#wave.setAttribute('d', this.#wavePath(waveHeight))
        }

        // The path is clipped at both ends: by the nested viewport at the handle, and at the start,
        // where a dot riding the wave rounds the cut off.
        setAttribute(this.#wave, 'transform', `translate(${(-this.#phase).toFixed(2)})`)
        setAttribute(this.#elapsed, 'width', position)
        setAttribute(this.#startCap, 'cy', centerY - Math.cos(this.#phase / wavelength * 2 * Math.PI) * waveHeight)
        // Nothing covers the dot on an empty bar without a handle.
        setAttribute(this.#startCap, 'visibility', this.#enabled || position > 0 ? 'visible' : 'hidden')

        setAttribute(this.#remaining, 'x1', position)
        setAttribute(this.#remaining, 'x2', width)
        setAttribute(this.#remaining, 'y1', centerY)
        setAttribute(this.#remaining, 'y2', centerY)

        const handle = `${position.toFixed(2)}px`
        if (handle !== this.#drawnHandle) {
            this.#drawnHandle = handle
            this.#root.style.setProperty('--progress', handle)
        }
    }

    /** The wave at phase zero, long enough to cover the bar at any phase. */
    #wavePath(waveHeight: number): string {
        const half = wavelength / 2
        const y = (offset: number) => (this.#centerY + offset).toFixed(3)

        let x = -half
        let offset = waveHeight
        let path = `M${x} ${y(0)}`
        while (x < this.#width + wavelength) {
            const middle = x + half / 2
            const next = x + half
            path += `C${middle} ${y(offset)} ${middle} ${y(-offset)} ${next} ${y(-offset)}`
            offset = -offset
            x = next
        }
        return path
    }
}
