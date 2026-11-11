import type { ParsedTrack } from '../wasm/localify_core'

/** Messages FileParserPool sends to a FileParserWorker. */
export type FileParserRequest =
    /** Asks for the batch plan of the picked files, given their names and MIME types in pick order. */
    | { type: 'plan'; names: string[]; types: string[] }
    /** Asks for one track; `index` is its position in the plan. */
    | { type: 'parse'; index: number; audio: File; lyrics: File | null }

/** Messages a FileParserWorker sends back. */
export type FileParserResponse =
    /** Flat pairs of indices into the picked files: [audioIndex, lyricsIndex or -1, ...]. */
    | { type: 'plan'; plan: Int32Array }
    /**
     * One track. `trapped` means the parser crashed on this file, so `track` holds values derived from the
     * file name and the worker can't parse anything else: it has to be replaced.
     */
    | { type: 'parsed'; index: number; track: ParsedTrack; trapped: boolean }
    /** The worker can't serve requests, for example because the wasm module failed to load. */
    | { type: 'failed'; message: string }
