import { getLyricsKind } from '../lyrics/lrcutils'
import { reducedMotion } from '../motion'
import type { Track } from '../track/Track'
import { queueMotion } from './QueueMotion'
import type { QueueTrackEntry } from './QueueTrackEntry'

interface Details {
    entry: QueueTrackEntry
    element: HTMLDivElement
    panel: HTMLDivElement
    resize?: Animation
}

/** The least space kept between the panel and the bar over the list's end. */
const edgeMargin = 10

const lyricsLevels = { none: 0, plain: 1, synced: 2, 'word-synced': 3 }
const lyricsLabels = { none: 'None', plain: 'Plain', synced: 'Synced', 'word-synced': 'Word-synced' }

function element<T extends keyof HTMLElementTagNameMap>(tag: T, className?: string, text?: string) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

function icon(name: string) {
    const node = element('span', 'icon')
    node.setAttribute('aria-hidden', 'true')
    node.dataset.icon = name
    return node
}

/**
 * A date tag in the reader's own date format, to the precision the tag has: a year, a month or a day.
 * Text that doesn't start with a date is returned as it is.
 */
function formatDate(tag: string) {
    const match = tag.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?![\d-])/)
    if (!match) return tag
    const [year, month, day] = match.slice(1).map(part => part === undefined ? undefined : Number(part))
    if (month === undefined) return match[1]
    const date = new Date(Date.UTC(year!, month - 1, day ?? 1))
    // A month or day out of range rolls over into another date.
    if (date.getUTCMonth() !== month - 1 || (day !== undefined && date.getUTCDate() !== day)) return tag
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: day === undefined ? undefined : 'numeric',
        timeZone: 'UTC',
    }).format(date)
}

/** A section of the panel: an icon beside rows of a label and a value. */
function section(iconName: string, rows: [label: string, value: HTMLElement][]) {
    const node = element('section')
    const list = element('dl')
    for (const [label, value] of rows) list.append(element('dt', undefined, label), value)
    node.append(icon(iconName), list)
    return node
}

/** A value cell. A missing value reads "Unknown" and is dimmed. */
function value(text: string | undefined) {
    const node = element('dd', undefined, text ?? 'Unknown')
    if (text === undefined) node.dataset.unknown = 'true'
    else node.title = text
    return node
}

function lyricsValue(track: Track) {
    const kind = track.lyrics ? getLyricsKind(track.lyrics) : 'none'
    const node = element('dd', 'lyricsKind')
    const level = element('span', 'lyricsLevel')
    level.setAttribute('aria-hidden', 'true')
    level.dataset.level = String(lyricsLevels[kind])
    level.append(element('i'), element('i'), element('i'))
    node.append(level, element('span', undefined, lyricsLabels[kind]))
    if (kind === 'none') node.dataset.unknown = 'true'
    return node
}

/** A loudness row that has nothing to show: an empty meter and a value without a number. */
function loudnessValue() {
    const node = element('dd', 'loudness')
    node.append(element('span', 'meter'), element('span', undefined, '– LUFS'))
    return node
}

function buildPanel(track: Track, onClose: () => void) {
    const panel = element('div', 'panel')
    panel.setAttribute('role', 'group')
    panel.setAttribute('aria-label', `Details of ${track.title}`)

    const close = element('button', 'close')
    close.type = 'button'
    // The list owns keyboard focus, as with the rows' play buttons.
    close.tabIndex = -1
    close.title = 'Hide details'
    close.setAttribute('aria-label', 'Hide details')
    close.append(icon('close'))
    close.addEventListener('mousedown', event => event.preventDefault())
    close.addEventListener('click', onClose)

    const release: [string, HTMLElement][] = [
        ['Album', value(track.album)],
        ['Released', value(track.released && formatDate(track.released))],
    ]
    if (track.firstReleased && track.firstReleased !== track.released)
        release.push(['First released', value(formatDate(track.firstReleased))])

    const loudness = section('graphic_eq', [
        ['Perceived', loudnessValue()],
        ['Normalized', loudnessValue()],
    ])
    loudness.dataset.placeholder = 'true'
    loudness.append(element('span', 'note', "Loudness isn't measured yet."))

    panel.append(
        close,
        section('audio_file', [
            ['Codec', value(track.codec)],
            ['Format', value(track.container ?? (track.format ? track.format.toUpperCase() : undefined))],
            ['Bitrate', value(track.bitrate === undefined ? undefined : `${track.bitrate} kbps`)],
        ]),
        section('album', release),
        section('lyrics', [['Lyrics', lyricsValue(track)]]),
        loudness,
    )
    return panel
}

/**
 * A panel of one track's details, which opens in the list right below the track's row and pushes the rows
 * beneath it down. The row and the panel share one background and outline. One track's details are open at
 * a time; a panel that is closing stays in the list until it has folded away.
 */
export class QueueTrackDetails {
    #list: HTMLElement
    #onResize: () => void
    #open: Details | undefined
    #closing = new Set<Details>()
    #frame: number | undefined

    /** `onResize` runs on every frame in which a panel opens or closes, once the list is laid out for it. */
    constructor(list: HTMLElement, onResize: () => void) {
        this.#list = list
        this.#onResize = onResize
        // Pressing anywhere outside the open track's row and panel closes its details. The context menu
        // doesn't count, as its entries act on the row it was opened on, and neither does the list's scrollbar.
        document.addEventListener('pointerdown', event => {
            const open = this.#open
            if (!open || !(event.target instanceof Element)) return
            const row = open.entry.track.domElement
            if (row?.contains(event.target) || open.element.contains(event.target)) return
            if (event.target.closest('.contextMenu') || this.#onScrollbar(event)) return
            this.Hide()
        }, { capture: true })
    }

    /** The track whose details are open. */
    get Entry() {
        return this.#open?.entry
    }

    /** Every panel in the list, open or closing. The list moves them along with their rows. */
    get Elements() {
        return [...this.#all()].map(details => details.element)
    }

    /** The panels of one track, open or closing. */
    ElementsOf(entry: QueueTrackEntry) {
        return [...this.#all()].filter(details => details.entry === entry).map(details => details.element)
    }

    Show(entry: QueueTrackEntry) {
        const row = entry.track.domElement
        if (!row || this.#open?.entry === entry) return
        this.Hide()

        const details: Details = {
            entry,
            element: element('div', 'queueTrackDetails'),
            panel: buildPanel(entry.track, () => this.Hide()),
        }
        details.element.append(details.panel)
        // A panel shares its row's flex order, so the document order puts it right after the row.
        row.after(details.element)
        this.#open = details
        row.dataset.details = 'true'
        this.Sync()

        if (reducedMotion.matches) {
            this.#onResize()
            this.#reveal()
            return
        }
        const height = details.element.offsetHeight
        details.resize = details.element.animate([
            { height: '0px', opacity: 0 },
            { height: `${height}px`, opacity: 1 },
        ], queueMotion)
        this.#followResize()
    }

    Hide() {
        const details = this.#open
        if (!details) return
        this.#open = undefined
        delete details.entry.track.domElement?.dataset.details
        details.element.dataset.closing = 'true'
        if (reducedMotion.matches) {
            details.element.remove()
            this.#onResize()
            return
        }
        this.#closing.add(details)
        // Folds from wherever an unfinished opening has got to.
        const { height, opacity } = getComputedStyle(details.element)
        details.resize?.cancel()
        details.resize = details.element.animate(
            [{ height, opacity }, { height: '0px', opacity: 0 }],
            { ...queueMotion, fill: 'forwards' },
        )
        details.resize.onfinish = () => {
            details.element.remove()
            this.#closing.delete(details)
        }
        this.#followResize()
    }

    /**
     * Stops managing the panels of `entry`, open or closing, and returns them still in the list, so the
     * caller can take them out along with the row.
     */
    Release(entry: QueueTrackEntry) {
        const released: HTMLDivElement[] = []
        for (const details of this.#all()) {
            if (details.entry !== entry) continue
            if (details === this.#open) {
                this.#open = undefined
                delete entry.track.domElement?.dataset.details
            }
            this.#closing.delete(details)
            details.resize?.cancel()
            details.element.dataset.closing = 'true'
            released.push(details.element)
        }
        return released
    }

    /** Gives each panel its row's flex order. Call it whenever the rows are reordered. */
    Sync() {
        for (const { entry, element } of this.#all()) {
            const order = entry.track.domElement?.style.order
            if (order) element.style.order = order
        }
    }

    /** Whether `event` lands on the list's scrollbar, classic or overlay. */
    #onScrollbar(event: PointerEvent) {
        const list = this.#list
        if (event.target !== list || list.scrollHeight <= list.clientHeight) return false
        let right = list.getBoundingClientRect().left + list.clientLeft + list.clientWidth
        // Overlay scrollbars occupy the right padding without reducing clientWidth.
        if (list.offsetWidth === list.clientWidth) right -= parseFloat(getComputedStyle(list).paddingRight)
        return event.clientX >= right
    }

    *#all() {
        if (this.#open) yield this.#open
        yield* this.#closing
    }

    /** Runs `onResize` and keeps the opening panel in view on every frame until no panel is resizing. */
    #followResize() {
        if (this.#frame !== undefined) return
        const frame = () => {
            this.#onResize()
            this.#reveal()
            const resizing = [...this.#all()].some(details => details.resize?.playState === 'running')
            this.#frame = resizing ? requestAnimationFrame(frame) : undefined
        }
        this.#frame = requestAnimationFrame(frame)
    }

    /**
     * Scrolls the list until the open panel clears the bar over the list's end, as far as its row stays in
     * view. While the panel grows, this runs every frame, so the list scrolls with it.
     */
    #reveal() {
        const open = this.#open
        const row = open?.entry.track.domElement
        if (!open || !row) return
        const list = this.#list
        const style = getComputedStyle(list)
        const bounds = list.getBoundingClientRect()
        const visibleTop = bounds.top + parseFloat(style.scrollPaddingTop) + edgeMargin
        const visibleBottom = bounds.bottom - parseFloat(style.scrollPaddingBottom) - edgeMargin
        const hidden = open.element.getBoundingClientRect().bottom - visibleBottom
        const room = row.getBoundingClientRect().top - visibleTop
        const distance = Math.min(hidden, room)
        if (distance > 0) list.scrollTop += distance
    }
}
