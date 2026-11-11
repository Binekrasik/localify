/* tslint:disable */
/* eslint-disable */

export interface ParsedTrack {
    title: string
    artist: string
    album: string
    /** The file name's extension, lowercased; '' when it has none. */
    format: string
    /** '#rrggbb'. */
    accentColor: string
    /** The embedded cover's bytes in an ArrayBuffer of their own (not a view of wasm memory), so `cover.buffer` can be transferred. */
    cover: Uint8Array | null
    /** The cover's MIME type; null exactly when `cover` is. */
    coverFormat: string | null
    /** True when there is a cover the library could not decode: a format without a decoder here (anything but JPEG and PNG), an interlaced PNG, an image over 4096 × 4096 pixels, or data the decoder rejected. `accentColor` is then the default, and the caller may decode the cover itself and call `accentFromRgba`. False when the cover was decoded, even if no pixel qualified. */
    coverUndecoded: boolean
    /** The lyrics file's text, trimmed; null without a readable lyrics file. */
    lyrics: string | null
    /** Why the tags couldn't be read; null on success. */
    error: string | null
}



/**
 * Accent colour (`#rrggbb`) of an RGBA image of any size, sampled like a decoded cover.
 */
export function accentFromRgba(pixels: Uint8Array, width: number, height: number): string;

/**
 * Parses an audio file and reads its lyrics file. Returns a plain, structured-cloneable object.
 *
 * Unreadable files give fallback values and `error`. A throw means the wasm instance trapped and
 * must be discarded.
 */
export function parseTrack(audio: File, lyrics?: File | null): ParsedTrack;

/**
 * Flat pairs `[audioIndex, lyricsIndex or -1, ...]`, indices into `names`.
 */
export function planBatch(names: string[], types: string[]): Int32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly accentFromRgba: (a: number, b: number, c: number, d: number) => [number, number];
    readonly parseTrack: (a: any, b: number) => any;
    readonly planBatch: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
