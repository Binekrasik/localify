export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export type Easing = (progress: number) => number

type Point = readonly [x: number, y: number]
type Segment = readonly [control1: Point, control2: Point, end: Point]

function cubic(a: number, b: number, c: number, d: number, t: number): number {
    const u = 1 - t
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/**
 * Easing along a chain of cubic curves from (0, 0) to (1, 1), like Android's PathInterpolator.
 * Each segment's x has to increase along the curve.
 */
export function pathEasing(...segments: Segment[]): Easing {
    return progress => {
        if (progress <= 0) return 0
        if (progress >= 1) return 1

        let start: Point = [0, 0]
        for (const [control1, control2, end] of segments) {
            if (progress > end[0]) {
                start = end
                continue
            }

            let low = 0
            let high = 1
            for (let i = 0; i < 24; i++) {
                const middle = (low + high) / 2
                if (cubic(start[0], control1[0], control2[0], end[0], middle) < progress) low = middle
                else high = middle
            }
            return cubic(start[1], control1[1], control2[1], end[1], (low + high) / 2)
        }
        return 1
    }
}

/** The easing CSS writes as `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
    return pathEasing([[x1, y1], [x2, y2], [1, 1]])
}
