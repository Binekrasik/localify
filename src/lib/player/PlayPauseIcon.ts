import { cubicBezier, reducedMotion } from '../motion'

const svgNamespace = 'http://www.w3.org/2000/svg'

// The duration and curve of Android's play/pause icon morph.
const duration = 333
const easing = cubicBezier(0.2, 0, 0, 1)

/**
 * Two polygons in a 40 unit box. A round-joined stroke in the fill colour rounds their corners,
 * so its width sets the corner radius.
 */
interface Shape {
    left: number[]
    right: number[]
    stroke: number
}

// The right polygon is the whole triangle and covers the left one, a sliver along its back edge.
const play: Shape = {
    left: [14.73, 29.13, 19.5, 26.09, 19.5, 13.91, 14.73, 10.87],
    right: [14.73, 29.13, 14.73, 29.13, 29.05, 20, 14.73, 10.87, 14.73, 10.87],
    stroke: 2.8,
}

const pause: Shape = {
    left: [12.5, 28.89, 14.03, 28.89, 14.03, 11.11, 12.5, 11.11],
    right: [25.97, 28.89, 27.5, 28.89, 27.5, 20, 27.5, 11.11, 25.97, 11.11],
    stroke: 5.56,
}

/** A play icon that morphs into a pause icon and back. */
export class PlayPauseIcon {
    readonly element: SVGSVGElement
    #left: SVGPolygonElement
    #right: SVGPolygonElement

    /** 0 is the play icon and 1 the pause icon. */
    #position: number
    #target: number
    #morph: { from: number; start: number } | null = null
    #frame = 0

    constructor(playing = false) {
        this.element = document.createElementNS(svgNamespace, 'svg')
        this.element.setAttribute('class', 'playPauseIcon')
        this.element.setAttribute('viewBox', '0 0 40 40')
        this.element.setAttribute('aria-hidden', 'true')

        this.#left = document.createElementNS(svgNamespace, 'polygon')
        this.#right = document.createElementNS(svgNamespace, 'polygon')
        this.element.append(this.#left, this.#right)

        this.#position = this.#target = playing ? 1 : 0
        this.#draw()
    }

    /** Shows the pause icon while `playing`, morphing to it unless `animate` is false. */
    Set(playing: boolean, animate = true) {
        const target = playing ? 1 : 0

        if (!animate || reducedMotion.matches || !this.element.isConnected) {
            cancelAnimationFrame(this.#frame)
            this.#morph = null
            this.#position = this.#target = target
            this.#draw()
            return
        }

        if (target === this.#target) return
        this.#target = target

        if (!this.#morph) this.#frame = requestAnimationFrame(this.#step)
        this.#morph = { from: this.#position, start: performance.now() }
    }

    #step = (now: number) => {
        if (!this.#morph) return

        const progress = Math.max(now - this.#morph.start, 0) / duration
        this.#position = this.#morph.from + (this.#target - this.#morph.from) * easing(progress)
        this.#draw()

        if (progress < 1) this.#frame = requestAnimationFrame(this.#step)
        else this.#morph = null
    }

    #draw() {
        const mix = (from: number, to: number) => (from + (to - from) * this.#position).toFixed(2)
        const points = (from: number[], to: number[]) => from.map((value, i) => mix(value, to[i])).join(' ')

        this.#left.setAttribute('points', points(play.left, pause.left))
        this.#right.setAttribute('points', points(play.right, pause.right))
        this.element.setAttribute('stroke-width', mix(play.stroke, pause.stroke))
    }
}
