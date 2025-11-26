import { getTimestampTag } from './lrcutils'
import sqs, { sqsa } from '../safeQuerySelector'
import { Manager } from '../Manager'
import { Managers } from '../state/Managers'
import { LyricsEditor } from './LyricsEditor'
import type { LyricsLine } from './LyricsLine'

export class LyricsManager extends Manager {
    state = {
        lines: [] as LyricsLine[],
        text: '',
        currentLineIndex: -1,
        synced: true,
        editingMode: true,
    }

    #lyricsEditor = new LyricsEditor()
    #lyricsElement = sqs('#lyrics') as HTMLDivElement

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

        document.addEventListener('wheel', () => this.UnsyncLyrics())
        document.addEventListener('touchmove', () => this.UnsyncLyrics())

        Managers.UpdateManager.AddUpdateListener(() => this.UpdateSyncedLyrics())

        this.ParseLoadLyricsText('[ar: no lyrics]\n[ti: There\'s absolutely nothing lol]')
    }

    /**
     * Resets the current lyrics state and clears the lyrics element
     */
    ResetLyrics () {
        this.state.lines = []
        this.#lyricsElement.innerHTML = ''
    }

    /**
     * Parses and loads lyrics from the given text
     * @param text Optional. LRC text to parse. If not provided, uses the current state's text.
     * @param editingMode Optional. If true, adds timestamps alongside lyrics. Defaults to current editingMode state.
     */
    ParseLoadLyricsText (text: string | null = null, editingMode: boolean = this.state.editingMode) {
        // keep track of count of the actual lines
        let index = 0

        // update the stored text if `text` is provided
        if (text)
            this.state.text = text
    
        console.log('Parsing lyrics...')
    
        this.#lyricsElement.innerHTML =
            `
            <div class="header">
                <h1 class="author"></h1>
                <h1 class="title"></h1>
            </div>
            `.trim()
    
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
                    const time = minutes * 60 + seconds
    
                    // prevent HTML injection
                    const text = match[3].trim().length > 0 ? match[3].replaceAll(/\<.*?\>/gmi, '').trim() : '♪'
                    this.state.lines.push({ time, index, text })
    
                    index++
                } else {
                    // match lrc title
                    const author = line.match(/\[ar:(.*)\]/)
                    const title = line.match(/\[ti:(.*)\]/)
    
                    // @ts-ignore
                    if (author) sqs('#lyrics .header .author').innerText = author[1].trim()
    
                    // @ts-ignore
                    if (title) sqs('#lyrics .header .title').innerText = title[1].trim()
                }
            })
    
        // insert all lines into the lyrics element
        this.#lyricsElement.innerHTML += this.state.lines.map(line =>
            `<p
                class="lyricsLine"
                data-time="${line.time}"
                data-index="${line.index}"
                style="animation-delay: ${line.index * 0.01}s;"
            >
                ${editingMode ? `<span class="timestamp">${getTimestampTag(line.time)}</span>` : ''}<span>${line.text}</span>
            </p>`.trim()
        ).join('')
    
        this.#lyricsElement.innerHTML += '<h2 class="theEnd">- THE END -</h2>'
    
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

    SyncLyrics () {
        this.state.synced = true
        Managers.PlayerManager.controls.syncButton.disabled = true
    }

    UnsyncLyrics () {
        this.state.synced = false
        Managers.PlayerManager.controls.syncButton.disabled = false
    }

    LoadFromFile (file: File) {
        console.log(`Loading lyrics from .lrc file: ${file.name}`)

        // load lyrics asynchronously
        file.text()
            .then(res => res.trim())
            .then(text => {
                this.ResetLyrics()

                this.state.text = text
                this.ParseLoadLyricsText()

                console.log(`${file.name} loaded.`)
            })
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
                const p = document.querySelector(`p[data-index="${line.index}"]`)
                if (!p) return
    
                // console.log(`Current line: ${ line.text }`)
                if (this.state.synced) p.scrollIntoView({ behavior: 'smooth', block: 'center' })
    
                p.setAttribute('data-active', 'true')
                this.state.currentLineIndex = line.index
            })
    
        if (time === Managers.PlayerManager.audioElement.duration)
            this.state.currentLineIndex = -1
    }
}