import { getTimestampTag } from './lrcutils'
import sqs, { sqsa } from '../shortQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
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
        editingMode: true,
    }

    #lyricsEditor = new LyricsEditor()
    #lyricsElement = sqs('#lyrics') as HTMLDivElement
    #lyricsContainerElement = sqs('#lyricsContainer') as HTMLDivElement
    #lyricsPositionIndicator = sqs('#lyrics-positionIndicator') as HTMLParagraphElement

    Initialize(): void {
        this.#InitHooks()
        // this.#lyricsEditor.Enable()
    }

    #InitHooks (): void {
        /* sqs('#player-file-lyrics').addEventListener('change', event => {
            const target = event.target as HTMLInputElement
            const file = target.files?.[0]
            if (!file) return

            this.LoadFromFile(file)
        }) */

        this.#lyricsContainerElement.addEventListener('wheel', () => this.UnsyncLyrics())
        this.#lyricsContainerElement.addEventListener('touchmove', () => this.UnsyncLyrics())

        Managers.UpdateManager.AddUpdateListener(() => this.UpdateSyncedLyrics())

        this.ResetLyrics()
    }

    /**
     * Resets the current lyrics state and clears the lyrics element
     */
    ResetLyrics () {
        this.ParseLoadLyricsText()
        this.SetAccentColor('#000')
    }

    /**
     * Parses and loads lyrics from the given text
     * @param text Optional. LRC text to parse. If not provided, uses the current state's text.
     * @param editingMode Optional. If true, adds timestamps alongside lyrics. Defaults to current editingMode state.
     */
    ParseLoadLyricsText (text?: string, track?: Track, editingMode: boolean = this.state.editingMode) {
        // keep track of count of the actual lines
        let index = 0

        // clear lines buffer
        this.state.lines = []

        // update the stored text if `text` is provided
        if (text && text.trim() !== '')
            this.state.text = text
        else if (track?.lyrics)
            this.state.text = track.lyrics
        else this.state.text = '[ar: no lyrics]\n[ti: There\'s absolutely nothing lol]'
    
        console.log('Parsing lyrics...')
    
        this.#lyricsElement.innerHTML =
            `
            <div class="header">
                <h1 class="author"></h1>
                <h1 class="title"></h1>
            </div>
            `.trim()

        const headerElements = {
            author: sqs('#lyrics .header .author') as HTMLHeadingElement,
            title: sqs('#lyrics .header .title') as HTMLHeadingElement,
        }
    
        this.state.text
            .split('\n')
            .forEach(line => {
                // parse line with the timestamp regex - [mm:ss..*?]<text>
                const match = line.match(/\[(\d{2}):(\d{2}\..*?)\](.*)/)
    
                // check if matched
                if (match) {
                    const minutes = parseInt(match[1], 10)
                    const seconds = parseFloat(match[2])
    
                    // parse time into seconds
                    let time = minutes * 60 + seconds

                    // insert 00:00.00 timestamp if it's not present
                    if (time > 0 && index === 0) {
                        this.state.lines.push({ time: 0, index, text: '♪' })
                        index++
                    }
    
                    // prevent HTML injection
                    const text = match[3].trim().length > 0 ? match[3].replaceAll(/\<.*?\>/gmi, '').trim() : '♪'
                    this.state.lines.push({ time, index, text })
    
                    index++
                } else {
                    // match lrc title
                    const author = line.match(/\[ar:(.*)\]/)
                    const title = line.match(/\[ti:(.*)\]/)

                    if (author)
                        headerElements.author.innerText = author[1].trim()

                    if (title)
                        headerElements.title.innerText = title[1].trim()
                }
            })

        if (track) {
            if (headerElements.author.innerText === '')
                headerElements.author.innerText = track.artist

            if (headerElements.title.innerText === '')
                headerElements.title.innerText = track.title
        }
    
        // insert all lines into the lyrics element
        this.#lyricsElement.innerHTML += this.state.lines.map(line =>
            `<p
                class="lyricsLine"
                data-time="${line.time}"
                data-index="${line.index}"
                style="animation-delay: ${line.index * 0.01}s;"
            >
                ${editingMode ? `<span class="timestamp">${getTimestampTag(line.time)}</span>` : ''}<span class="textContent">${line.text}</span>
            </p>`.trim()
        ).join('')
    
        this.#lyricsElement.innerHTML += '<h2 class="theEnd">fin.</h2>'
    
        this.#lyricsElement
            .querySelectorAll('.lyricsLine')
            .forEach(p => {
                p.addEventListener('click', () => {
                    Managers.PlayerManager.audioElement.currentTime = parseFloat(p.getAttribute('data-time')!)
                    this.#lyricsEditor.SetLyricsLineIndex(parseInt(p.getAttribute('data-index')!))

                    this.SyncLyrics()
                })
            })
    
        // this.#lyricsEditor.UpdateLineIndicator()
    }

    SetAccentColor (color: string) {
        console.log(`Settings lyrics accent color to ${color}`)

        const lyricsContainer = sqs('#lyricsContainer') as HTMLDivElement
        lyricsContainer.style.setProperty('--color-accent', color)
    }

    SyncLyrics () {
        this.state.synced = true
        Managers.PlayerManager.controls.syncButton.disabled = true
    }

    UnsyncLyrics () {
        this.state.synced = false
        Managers.PlayerManager.controls.syncButton.disabled = false
    }

    UpdateLyricsPositionIndicator (overridePaused: boolean = false): boolean | void {
        if (Managers.PlayerManager.audioElement.paused && !overridePaused) return true

        console.log('UpdateLyricsPositionIndicator')

        if (!this.state.currentLineElement) return
        
        const nextIndex = this.state.currentLineIndex + 1 < this.state.lines.length ? this.state.currentLineIndex + 1 : -1
        let nextTime = nextIndex !== -1 ? parseFloat(sqs(`.lyricsLine[data-index="${nextIndex}"]`).getAttribute('data-time')!) : Managers.PlayerManager.audioElement.duration

        const textSpan = this.state.currentLineElement.querySelector('.textContent') as HTMLSpanElement

        const currentPercentage =
            ( Managers.PlayerManager.audioElement.currentTime - parseFloat(this.state.currentLineElement.getAttribute('data-time')!) )
            / ( nextTime - parseFloat(this.state.currentLineElement.getAttribute('data-time')!) )

        const topOffset = textSpan.clientHeight * currentPercentage

        // console.log(currentPercentage)
        // console.log(topOffset)

        this.#lyricsPositionIndicator.style.setProperty('top', `${this.state.currentLineElement.offsetTop}px`)
        this.#lyricsPositionIndicator.style.setProperty('left', `${this.state.currentLineElement.offsetLeft}px`)
        this.#lyricsPositionIndicator.style.setProperty('height', `${topOffset}px`)
    }

    LoadFromTrack (track: Track) {
        if (track.lyrics) {
            this.ResetLyrics()

            this.state.text = track.lyrics
            this.ParseLoadLyricsText(undefined, track)
        } else {
            this.ParseLoadLyricsText(`[ar: ${track.artist}]\n[ti: ${track.title}]\n`)
        }

        this.SetAccentColor(track.accentColor)
    }

    UpdateSyncedLyrics () {
        const time = Managers.PlayerManager.audioElement.currentTime
    
        sqsa('p[data-active="true"]')
            .filter(line => line.getAttribute('data-index') !== `${this.state.currentLineIndex}` || this.state.currentLineIndex === -1)
            .forEach(line => line.setAttribute('data-active', 'false'))
    
        // find the current line
        this.state.lines
            .filter((line, index) => line.time <= time && (this.state.lines[index + 1]?.time > time || index + 1 === this.state.lines.length))
            .forEach(line => {
                const p = document.querySelector(`p[data-index="${line.index}"]`) as HTMLParagraphElement
                if (!p) return
    
                // console.log(`Current line: ${ line.text }`)
                if (this.state.synced) p.scrollIntoView({ behavior: 'smooth', block: 'center' })
    
                p.setAttribute('data-active', 'true')
                this.state.currentLineIndex = line.index
                this.state.currentLineElement = p
            })
    
        if (time === Managers.PlayerManager.audioElement.duration) {
            this.state.currentLineIndex = -1
        }
    }
}