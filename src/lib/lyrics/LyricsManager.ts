import { getTimestampTag } from './lrcutils'
import sqs, { sqsa } from '../shortQuerySelector'
import { Manager } from '../Manager'
import { bus, updateManager } from '../state/Managers'
import { LyricsEditor } from './LyricsEditor'
import type { LyricsLine } from './LyricsLine'
import type { Track } from '../track/Track'

export class LyricsManager extends Manager {
    state = {
        lines: [] as LyricsLine[],
        text: '',
        currentLineIndex: -1,
        currentLineElement: null as HTMLParagraphElement | null,
        synced: true,
    }

    #lyricsEditor = new LyricsEditor()
    #lyricsElement = sqs<HTMLDivElement>('#lyrics')
    #lyricsContainerElement = sqs<HTMLDivElement>('#lyricsContainer')
    #lyricsPositionIndicator = sqs<HTMLParagraphElement>(
        '#lyrics-positionIndicator',
    )
    #audioElement = sqs<HTMLAudioElement>('#audioPlayer')
    #lyricsLineElements = new Map<number, HTMLParagraphElement>()

    Initialize(): void {
        this.#InitHooks()
        this.#initBusListeners()
    }

    #initBusListeners() {
        bus.on('track:loaded', ({ track }) => this.LoadFromTrack(track))
        bus.on('playback:seek', () => {
            this.SyncLyrics()
            this.UpdateLyricsPositionIndicator(true)
        })
        bus.on('playback:ended', () => this.UpdateLyricsPositionIndicator(true))
        bus.on('lyrics:sync-request', () => this.SyncLyrics())
        bus.on('lyrics:reset', () => {
            this.ResetLyrics()
            this.ParseLoadLyricsText()
        })
    }

    #InitHooks(): void {
        this.#lyricsContainerElement.addEventListener('wheel', () =>
            this.UnsyncLyrics(),
        )
        this.#lyricsContainerElement.addEventListener('touchmove', () =>
            this.UnsyncLyrics(),
        )

        updateManager.AddUpdateListener(() => {
            this.UpdateSyncedLyrics()
            this.UpdateLyricsPositionIndicator()
        })

        this.ResetLyrics()
    }

    ResetLyrics() {
        this.ParseLoadLyricsText()
        this.SetAccentColor('#000')
    }

    ParseLoadLyricsText(
        text?: string,
        track?: Track,
    ) {
        this.state.lines = []

        if (text && text.trim() !== '') this.state.text = text
        else if (track?.lyrics) this.state.text = track.lyrics
        else
            this.state.text =
                "[ar: no lyrics]\n[ti: There's absolutely nothing lol]"

        console.log('Parsing lyrics...')

        let author = ''
        let title = ''
        let index = 0

        this.state.text.split('\n').forEach((line) => {
            const match = line.match(/\[(\d{2}):(\d{2}\..*?)\](.*)/)

            if (match) {
                const minutes = parseInt(match[1], 10)
                const seconds = parseFloat(match[2])

                let time = minutes * 60 + seconds

                if (time > 0 && index === 0) {
                    this.state.lines.push({ time: 0, index, text: '♪' })
                    index++
                }

                const text =
                    match[3].trim().length > 0
                        ? match[3].replaceAll(/\<.*?\>/gim, '').trim()
                        : '♪'
                this.state.lines.push({ time, index, text })

                index++
            } else {
                const authorMatch = line.match(/\[ar:(.*)\]/)
                const titleMatch = line.match(/\[ti:(.*)\]/)

                if (authorMatch) author = authorMatch[1].trim()
                if (titleMatch) title = titleMatch[1].trim()
            }
        })

        const displayAuthor = author || track?.artist || ''
        const displayTitle = title || track?.title || ''

        const linesHtml = this.state.lines
            .map((line) =>
                `<p
                class="lyricsLine"
                data-time="${line.time}"
                data-index="${line.index}"
                style="animation-delay: ${line.index * 0.01}s;"
            >
                <span class="timestamp">${getTimestampTag(line.time)}</span><span class="textContent">${line.text}</span>
            </p>`.trim(),
            )
            .join('')

        this.#lyricsElement.innerHTML = `
            <div class="header">
                <h1 class="author">${displayAuthor}</h1>
                <h1 class="title">${displayTitle}</h1>
            </div>
            ${linesHtml}
            <h2 class="theEnd">fin.</h2>
        `.trim()

        this.#lyricsLineElements.clear()
        this.#lyricsElement.querySelectorAll('.lyricsLine').forEach((p) => {
            const lineIndex = parseInt(p.getAttribute('data-index')!)
            this.#lyricsLineElements.set(lineIndex, p as HTMLParagraphElement)

            p.addEventListener('click', () => {
                this.#audioElement.currentTime = parseFloat(
                    p.getAttribute('data-time')!,
                )
                this.#lyricsEditor.SetLyricsLineIndex(
                    parseInt(p.getAttribute('data-index')!),
                )

                this.SyncLyrics()
            })
        })
    }

    SetAccentColor(color: string) {
        console.log(`Settings lyrics accent color to ${color}`)

        const lyricsContainer = sqs<HTMLDivElement>('#lyricsContainer')
        lyricsContainer.style.setProperty('--color-accent', color)
    }

    SyncLyrics() {
        this.state.synced = true
        bus.emit('lyrics:synced', {})

        this.UpdateSyncedLyrics(true)
    }

    UnsyncLyrics() {
        this.state.synced = false
        bus.emit('lyrics:unsynced', {})
    }

    #cachedLineTop = 0
    #cachedLineLeft = 0

    UpdateLyricsPositionIndicator(
        overridePaused: boolean = false,
    ): boolean | void {
        if (this.#audioElement.paused && !overridePaused)
            return true

        if (!this.state.currentLineElement) return

        const nextIndex =
            this.state.currentLineIndex + 1 < this.state.lines.length
                ? this.state.currentLineIndex + 1
                : -1
        let nextTime =
            nextIndex !== -1
                ? parseFloat(
                      this.#lyricsLineElements.get(nextIndex)?.getAttribute('data-time')!,
                  )
                : this.#audioElement.duration

        const lineTime = parseFloat(
            this.state.currentLineElement.getAttribute('data-time')!,
        )
        const currentPercentage = (this.#audioElement.currentTime - lineTime) / (nextTime - lineTime)

        const textSpan = this.state.currentLineElement.querySelector(
            '.textContent',
        ) as HTMLSpanElement
        const topOffset = textSpan.clientHeight * currentPercentage

        const newTop = this.state.currentLineElement.offsetTop
        const newLeft = this.state.currentLineElement.offsetLeft

        if (newTop !== this.#cachedLineTop) {
            this.#lyricsPositionIndicator.style.setProperty('top', `${newTop}px`)
            this.#cachedLineTop = newTop
        }
        if (newLeft !== this.#cachedLineLeft) {
            this.#lyricsPositionIndicator.style.setProperty('left', `${newLeft}px`)
            this.#cachedLineLeft = newLeft
        }
        this.#lyricsPositionIndicator.style.setProperty('height', `${topOffset}px`)
    }

    LoadFromTrack(track: Track) {
        if (track.lyrics) {
            this.ResetLyrics()

            this.state.text = track.lyrics
            this.ParseLoadLyricsText(undefined, track)
        } else {
            this.ParseLoadLyricsText(
                `[ar: ${track.artist}]\n[ti: ${track.title}]\n`,
            )
        }

        this.SetAccentColor(track.accentColor)
    }

    UpdateSyncedLyrics(forceSync?: boolean) {
        const time = this.#audioElement.currentTime
        const lineChanging = this.state.currentLineIndex

        sqsa('p[data-active="true"]')
            .filter(
                (line) =>
                    line.getAttribute('data-index') !==
                        `${this.state.currentLineIndex}` ||
                    this.state.currentLineIndex === -1,
            )
            .forEach((line) => line.setAttribute('data-active', 'false'))

        this.state.lines
            .filter(
                (line, index) =>
                    line.time <= time &&
                    (this.state.lines[index + 1]?.time > time ||
                        index + 1 === this.state.lines.length),
            )
            .forEach((line) => {
                const p = this.#lyricsLineElements.get(line.index)
                if (!p) return

                if ((this.state.synced && line.index !== lineChanging) || (line.index === lineChanging && forceSync))
                    p.scrollIntoView({ behavior: 'smooth', block: 'center' })

                p.setAttribute('data-active', 'true')
                this.state.currentLineIndex = line.index
                this.state.currentLineElement = p
            })

        if (time === this.#audioElement.duration) {
            this.state.currentLineIndex = -1
        }
    }
}
