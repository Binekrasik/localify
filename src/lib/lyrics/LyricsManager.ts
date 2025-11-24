import { getTimestampTag } from '../../lrcutils'
import sqs from '../../safeQuerySelector'
import { Manager } from '../manager/Manager'
import type { LyricsLine } from './LyricsLine'

export class LyricsManager extends Manager {
    state = {
        lines: [] as LyricsLine[],
        text: '',
        currentLineIndex: -1,
    }

    #lyricsElement = sqs('#lyrics') as HTMLDivElement

    Initialize (): void {
        
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
     * @param editingMode Optional. If true, adds timestamps alongside lyrics. Defaults to false.
     */
    ParseLoadLyricsText (text: string | null = null, editingMode: boolean = false) {
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
                    audio.currentTime = parseFloat(p.getAttribute('data-time')!)
    
                    if (editingMode) setLyricsEditorLineIndex(parseInt(p.getAttribute('data-index')!))
    
                    syncLyrics()
                })
            })
    
        if (editingMode) updateEditorLineIndicator()
    }

    SyncLyrics () {

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

    //
    // Lyrics editing
    //
    
}