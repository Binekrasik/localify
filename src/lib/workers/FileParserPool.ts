import type { ParsedTrack } from '../wasm/localify_core'
import parserWasmUrl from '../wasm/localify_core_bg.wasm?url'
import type { FileParserRequest, FileParserResponse } from './FileParserMessages'
import FileParserWorker from './FileParserWorker?worker&inline'

const MAX_WORKERS = 4
let parserModule: Promise<WebAssembly.Module> | undefined

function loadFileParserModule() {
    return parserModule ??= fetch(parserWasmUrl).then(async response => {
        if (!response.ok) throw new Error(`Failed to download the file parser (${response.status})`)
        return WebAssembly.compile(await response.arrayBuffer())
    }).catch(error => {
        parserModule = undefined
        throw error
    })
}

export function preloadFileParser() {
    // A file batch retries the download and reports any error when it needs the parser.
    void loadFileParserModule().catch(() => {})
}

export interface ParsedFile {
    /** The track's position in the batch plan. */
    index: number
    audio: File
    track: ParsedTrack
}

export interface FileParserPoolHandlers {
    /** The plan holds `total` tracks, at least one. */
    onStart(total: number): void
    /** One track is parsed. Tracks arrive in completion order, not plan order. */
    onTrack(file: ParsedFile): void
    /** Every track has arrived, or the picked files hold no audio. */
    onDone(): void
    onError(error: unknown): void
}

/**
 * Parses one batch of picked files on several FileParserWorkers. The first worker plans the batch; then up to
 * `hardwareConcurrency - 1` workers, between 1 and 4, take tracks one at a time in plan order. A worker whose
 * parser crashed on a file is replaced by a fresh one. Every worker is terminated when the batch ends, fails or
 * is cancelled, and no handler runs after that.
 */
export class FileParserPool {
    #files: File[]
    #handlers: FileParserPoolHandlers
    #parserModule!: WebAssembly.Module
    #workers: Worker[] = []
    #plan: Int32Array = new Int32Array()
    #total = 0
    #sent = 0
    #received = 0
    #ended = false

    constructor(files: File[], handlers: FileParserPoolHandlers) {
        this.#files = files
        this.#handlers = handlers
        void this.#planBatch()
    }

    async #planBatch() {
        try {
            this.#parserModule = await loadFileParserModule()
            if (this.#ended) return
            this.#send(this.#spawn(), {
                type: 'plan',
                names: this.#files.map(file => file.name),
                types: this.#files.map(file => file.type),
            })
        } catch (error) {
            this.#fail(error)
        }
    }

    Cancel() {
        this.#end()
    }

    #spawn() {
        const worker = new FileParserWorker()
        worker.onmessage = (event: MessageEvent<FileParserResponse>) => this.#receive(worker, event.data)
        worker.onerror = event => this.#fail(event)
        worker.onmessageerror = () => this.#fail(new Error('A file parser reply could not be read'))
        this.#workers.push(worker)
        this.#send(worker, { type: 'init', module: this.#parserModule })
        return worker
    }

    #send(worker: Worker, request: FileParserRequest) {
        worker.postMessage(request)
    }

    /** Handles a worker's reply. Anything thrown on the way, such as a worker that can't be started, fails the batch. */
    #receive(worker: Worker, response: FileParserResponse) {
        if (this.#ended) return
        try {
            switch (response.type) {
                case 'plan':
                    this.#start(response.plan)
                    break
                case 'parsed':
                    this.#received++
                    this.#handlers.onTrack({
                        index: response.index,
                        audio: this.#files[this.#plan[response.index * 2]],
                        track: response.track,
                    })
                    if (this.#ended) return
                    if (this.#received === this.#total) {
                        this.#end()
                        this.#handlers.onDone()
                    } else if (this.#sent < this.#total) {
                        this.#sendNext(response.trapped ? this.#replace(worker) : worker)
                    }
                    break
                case 'failed':
                    this.#fail(new Error(response.message))
                    break
            }
        } catch (error) {
            this.#fail(error)
        }
    }

    /** Terminates `worker` and returns a fresh one in its place. */
    #replace(worker: Worker) {
        worker.terminate()
        this.#workers = this.#workers.filter(other => other !== worker)
        return this.#spawn()
    }

    #start(plan: Int32Array) {
        this.#plan = plan
        this.#total = plan.length / 2
        if (this.#total === 0) {
            this.#end()
            this.#handlers.onDone()
            return
        }

        this.#handlers.onStart(this.#total)
        if (this.#ended) return
        const cores = navigator.hardwareConcurrency || 2
        const workerCount = Math.min(this.#total, Math.min(Math.max(cores - 1, 1), MAX_WORKERS))
        while (this.#workers.length < workerCount) this.#spawn()
        for (const worker of this.#workers) this.#sendNext(worker)
    }

    /** Hands the next unsent track to `worker`. */
    #sendNext(worker: Worker) {
        const index = this.#sent++
        const lyricsIndex = this.#plan[index * 2 + 1]
        this.#send(worker, {
            type: 'parse',
            index,
            audio: this.#files[this.#plan[index * 2]],
            lyrics: lyricsIndex >= 0 ? this.#files[lyricsIndex] : null,
        })
    }

    #fail(error: unknown) {
        if (this.#ended) return
        this.#end()
        this.#handlers.onError(error)
    }

    #end() {
        this.#ended = true
        for (const worker of this.#workers) worker.terminate()
        this.#workers = []
    }
}
