import { getTimestampTag } from './lrcutils'
import './lyrics.scss'
import sqs, { sqsa } from './safeQuerySelector'

interface LyricsLine {
    time: number
    index: number
    text: string
}

const playerSettings = {
    editingMode: true,
}

const audio = sqs('#audioPlayer') as HTMLAudioElement

let lastUpdateTimestamp = performance.now()
const updateInterval = 10 // ms

const lyricsElement = sqs('#lyrics') as HTMLDivElement
let lyricsLines: LyricsLine[] = []
let lyricsText: string = ''

// parse the lyrics file
const parseLoadLyricsText = () => {
    // keep track of count of the actual lines
    let index = 0

    console.log('Parsing lyrics...')

    lyricsElement.innerHTML =
        `
        <div class="header">
            <h1 class="author"></h1>
            <h1 class="title"></h1>
        </div>
        `.trim()

    lyricsText
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
                lyricsLines.push({ time, index, text })

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
    lyricsElement.innerHTML += lyricsLines.map(line =>
        `<p
            class="lyricsLine"
            data-time="${line.time}"
            data-index="${line.index}"
            style="animation-delay: ${line.index * 0.01}s;"
        >
            ${playerSettings.editingMode ? `<span class="timestamp">${getTimestampTag(line.time)}</span>` : ''}<span>${line.text}</span>
        </p>`.trim()
    ).join('')

    lyricsElement.innerHTML += '<h2 class="theEnd">- THE END -</h2>'

    lyricsElement
        .querySelectorAll('.lyricsLine')
        .forEach(p => {
            p.addEventListener('click', () => {
                audio.currentTime = parseFloat(p.getAttribute('data-time')!)

                if (playerSettings.editingMode) setLyricsEditorLineIndex(parseInt(p.getAttribute('data-index')!))

                syncLyrics()
            })
        })

    if (playerSettings.editingMode) updateEditorLineIndicator()
}

const resetLyrics = () => {
    lyricsLines = []
    lyricsElement.innerHTML = ''
}

//
// initiaize player controls
//
// sync button
const syncButton = sqs('#player-button-sync') as HTMLButtonElement
syncButton.addEventListener('click', () => syncLyrics())

// play/pause button
const playButton = sqs('#player-button-playback') as HTMLButtonElement
const updatePlayButtonState = () => playButton.innerText = audio.paused ? '▶' : '❚❚'

playButton.addEventListener('click', () => {
    if (audio.paused) {
        audio.play()
    } else audio.pause()
})

audio.addEventListener('pause', updatePlayButtonState)
audio.addEventListener('play', updatePlayButtonState)

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault()
        playButton.click()
    }
})

// progress slider
const progressSlider = sqs('#player-slider-progress') as HTMLInputElement
// const progresLabel = sqs('#player-label-progress') as HTMLLabelElement

const updateProgressIndicators = () => {
    const progress = (audio.currentTime / audio.duration) * 100
    progressSlider.value = `${progress}`

    const time = (progress / 100) * audio.duration
    const minutes = Math.floor(time / 60) || '0'
    const seconds = Math.floor(time % 60) || '00'

    // @ts-ignore
    sqs('#player-label-progress .currentTime').innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`
}
/* progressSlider.addEventListener('change', () => {
    const time = (parseFloat(progressSlider.value) / 100) * audio.duration
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60).toString().padStart(2, '0')

    progresLabel.innerText = `${minutes}:${seconds}`
}) */

progressSlider.addEventListener('input', () => {
    audio.currentTime = (parseFloat(progressSlider.value) / 100) * audio.duration
    
    syncLyrics()
})

// volume slider
const volumeSlider = sqs('#player-slider-volume') as HTMLInputElement
audio.volume = parseFloat(volumeSlider.value) / 100

volumeSlider.addEventListener('input', () => {
    audio.volume = parseFloat(volumeSlider.value) / 100
})

// check if the audio is loaded and disable controls accordingly
const setControlsEnabled = (enabled: boolean) => {
    playButton.disabled = !enabled
    progressSlider.disabled = !enabled
    volumeSlider.disabled = !enabled
    syncButton.disabled = enabled ? synced : false
}

// disable controls by default
setControlsEnabled(false)

// disable/enable controls based on audio state
audio.addEventListener('emptied', () => setControlsEnabled(false))
audio.addEventListener('loadeddata', () => {
    setControlsEnabled(true)

    const minutes = Math.floor(audio.duration / 60)
    const seconds = Math.floor(audio.duration % 60).toString().padStart(2, '0')

    // @ts-ignore
    sqs('#player-label-progress .endTime').innerText = `${minutes}:${seconds}`
    updatePlayButtonState()
})

//
// file pickers
//

// audio picker
const audioFileInput = sqs('#player-file-audio') as HTMLInputElement
const lyricsFileInput = sqs('#player-file-lyrics') as HTMLInputElement

const tryLoadAudioFile = () => {
    const file = audioFileInput.files?.[0]
    if (!file) return

    if (!file.type.startsWith('audio/')) {
        alert('Invalid audio file.')
        return
    }

    console.log(`Loading audio file: ${file.name}`)
    const reader = new FileReader()

    reader.onload = () => {
        audio.innerHTML = `<source src="${reader.result}" type="${file.type}">`
        audio.load()

        console.log('loaded')
    }

    reader.readAsDataURL(file)
    audioFileInput.value = ''
}

const tryLoadLyricsFile = () => {
    const file = lyricsFileInput.files?.[0]
    if (!file) return

    console.log(`Loading lyrics file: ${file.name}`)
    file.text()
        .then(res => res.trim())
        .then(text => {
            resetLyrics()

            lyricsText = text
            parseLoadLyricsText()

            console.log('loaded')
        })

    lyricsFileInput.value = ''
}

audioFileInput.addEventListener('change', tryLoadAudioFile)
lyricsFileInput.addEventListener('change', tryLoadLyricsFile)

//
// lyrics syncing
//
let synced = false

const unsyncLyrics = () => {
    synced = false
    syncButton.disabled = false
}

const syncLyrics = () => {
    synced = true
    syncButton.disabled = true
}

document.addEventListener('wheel', unsyncLyrics)
document.addEventListener('touchmove', unsyncLyrics)

const requestStateUpdate = () => {
    window.requestAnimationFrame(timestamp => {
        if (timestamp - lastUpdateTimestamp >= updateInterval) {
            updateLyrics()
            updateProgressIndicators()

            console.log(timestamp - lastUpdateTimestamp)

            lastUpdateTimestamp = timestamp
        }

        requestStateUpdate()
    })
}

let currentLineIndex = -1

// update timed lyrics
const updateLyrics = () => {
    const time = audio.currentTime

    sqsa('p[data-active="true"]')
        .filter(line => line.getAttribute('data-index') !== `${currentLineIndex}` || currentLineIndex === -1)
        .forEach(line => line.setAttribute('data-active', 'false'))

    // find the current line
    lyricsLines
        .filter((line, index) => line.time <= time && (lyricsLines[index + 1]?.time > time || index + 1 === lyricsLines.length))
        .forEach(line => {
            const p = document.querySelector(`p[data-index="${line.index}"]`)
            if (!p) return

            // console.log(`Current line: ${ line.text }`)
            if (synced) p.scrollIntoView({ behavior: 'smooth', block: 'center' })

            p.setAttribute('data-active', 'true')
            currentLineIndex = line.index
        })

    if (time === audio.duration)
        currentLineIndex = -1
}

// start the update loop
requestStateUpdate()

//
// lyrics editor & timestamping
//
let lineIndex = 0

sqs('#player-button-reset-lyrics').addEventListener('click', () => {
    resetLyrics()
    parseLoadLyricsText()
    unsyncLyrics()
})

sqs('#player-button-mark-timestamp').addEventListener('click', () => {
    if (!playerSettings.editingMode) return

    const time = audio.currentTime // slight offset to account for human delay
    
    const p = document.querySelector(`p[data-index="${lineIndex}"]`)
    if (!p || !(p instanceof HTMLParagraphElement)) return

    console.log(`New line at ${time}s`)
    // element.style = "background: red;"

    // @ts-ignore
    sqs(`#lyrics p[data-index="${lineIndex}"] .timestamp`).innerText = getTimestampTag(time)

    // @ts-ignore
    sqs(`#lyrics p[data-index="${lineIndex}"] .timestamp`).setAttribute('data-modified', 'true')

    lineIndex++

    unsyncLyrics()
    sqs(`#lyrics p[data-index="${lineIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })

    updateEditorLineIndicator()
})

sqs('#player-button-prev-timestamp').addEventListener('click', () => {
    if (!playerSettings.editingMode) return

    lineIndex = Math.max(lineIndex - 1, 0)

    try {
        // @ts-ignore
        // sqs(`#lyrics p[data-index="${lineIndex}"] .timestamp`).innerText = '[00:00.00]'
        unsyncLyrics()
        sqs(`#lyrics p[data-index="${lineIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (e) {
        console.warn('No previous line available.')
    }

    updateEditorLineIndicator()
})

sqs('#player-button-next-timestamp').addEventListener('click', () => {
    if (!playerSettings.editingMode) return

    lineIndex = Math.max(lineIndex + 1, 0)
    
    try {
        // @ts-ignore
        // sqs(`#lyrics p[data-index="${lineIndex}"] .timestamp`).innerText = '[00:00.00]'
        unsyncLyrics()
        sqs(`#lyrics p[data-index="${lineIndex}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (e) {
        console.warn('No next line available.')
    }

    updateEditorLineIndicator()
})

function setLyricsEditorLineIndex (index: number) {
    if (!playerSettings.editingMode) return

    lineIndex = index
    updateEditorLineIndicator()
}

function updateEditorLineIndicator () {
    if (!playerSettings.editingMode) return

    try {
        const p = sqs(`#lyrics p[data-index="${lineIndex}"]`) as HTMLParagraphElement

        const x = p.offsetTop
        const y = p.offsetLeft - 15

        // @ts-ignore
        sqs('#lyrics-editor-line-indicator').style = `top: ${x}px; left: ${y}px; height: ${p.offsetHeight}px;`
    } catch (e) {
        console.warn('No line indicator .')
    }
}