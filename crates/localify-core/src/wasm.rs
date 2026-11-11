//! JavaScript bindings, generated with `wasm-bindgen --target web`.
//!
//! [`parse_track`] reads files with `FileReaderSync`, which exists only in workers, so the module
//! must be used from a dedicated worker. A function throws only when the instance traps (see the
//! crate docs); the instance is unusable from then on.

use std::io;

use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use web_sys::{Blob, File, FileReaderSync};

use crate::color;
use crate::plan;
use crate::source::RangeSource;
use crate::track;

#[wasm_bindgen(typescript_custom_section)]
const PARSED_TRACK: &str = r#"
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
"#;

/// Parses an audio file and reads its lyrics file. Returns a plain, structured-cloneable object.
///
/// Unreadable files give fallback values and `error`. A throw means the wasm instance trapped and
/// must be discarded.
#[wasm_bindgen(js_name = parseTrack, unchecked_return_type = "ParsedTrack")]
pub fn parse_track(audio: &File, lyrics: Option<File>) -> JsValue {
    let reader = FileReaderSync::new().map_err(|e| js_error(&e));
    let source = |blob: &Blob| BlobSource {
        len: blob_size(blob),
        blob: blob.clone(),
        reader: reader.clone(),
    };
    let track = track::parse_track(
        &audio.name(),
        source(audio),
        lyrics.as_ref().map(|f| source(f)),
        js_sys::Math::random(),
    );
    track_to_js(track)
}

/// Flat pairs `[audioIndex, lyricsIndex or -1, ...]`, indices into `names`.
#[wasm_bindgen(js_name = planBatch)]
pub fn plan_batch(names: Vec<String>, types: Vec<String>) -> Vec<i32> {
    // wasm32 memory can't hold 2^31 names, so every index fits in an i32.
    let index = |i: usize| i32::try_from(i).unwrap_or(i32::MAX);
    plan::plan_batch(&names, &types)
        .into_iter()
        .flat_map(|e| [index(e.audio), e.lyrics.map_or(-1, index)])
        .collect()
}

/// Accent colour (`#rrggbb`) of an RGBA image of any size, sampled like a decoded cover.
#[wasm_bindgen(js_name = accentFromRgba)]
pub fn accent_from_rgba(
    #[wasm_bindgen(unchecked_param_type = "Uint8Array")] pixels: &[u8],
    width: u32,
    height: u32,
) -> String {
    color::to_hex(color::accent_from_rgba(
        pixels,
        width,
        height,
        js_sys::Math::random(),
    ))
}

fn track_to_js(track: track::Track) -> JsValue {
    let obj = Object::new();
    let set = |key: &str, value: JsValue| {
        // Defining a property on a fresh plain object can't fail.
        let _ = Reflect::set(&obj, &JsValue::from_str(key), &value);
    };
    let opt_str = |s: Option<String>| s.map_or(JsValue::NULL, |s| JsValue::from_str(&s));
    let (cover, cover_format) = match track.cover {
        Some(picture) => (
            Uint8Array::from(picture.data.as_slice()).into(),
            JsValue::from_str(&picture.mime),
        ),
        None => (JsValue::NULL, JsValue::NULL),
    };
    set("title", track.title.into());
    set("artist", track.artist.into());
    set("album", track.album.into());
    set("format", track.format.into());
    set("accentColor", color::to_hex(track.accent).into());
    set("cover", cover);
    set("coverFormat", cover_format);
    set("coverUndecoded", track.cover_undecoded.into());
    set("lyrics", opt_str(track.lyrics));
    set("error", opt_str(track.error));
    obj.into()
}

/// A `Blob` read with `FileReaderSync`, one `slice` per range.
struct BlobSource {
    blob: Blob,
    len: u64,
    /// The error from constructing the reader outside a worker, reported on every read.
    reader: Result<FileReaderSync, String>,
}

impl RangeSource for BlobSource {
    fn size(&self) -> u64 {
        self.len
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let reader = self
            .reader
            .as_ref()
            .map_err(|e| io::Error::other(e.clone()))?;
        let end = offset.saturating_add(buf.len() as u64).min(self.len);
        if offset >= end {
            return Ok(0);
        }
        // Blob offsets are doubles; file sizes stay far below 2^53, where they are exact.
        #[expect(clippy::cast_precision_loss, reason = "exact below 2^53")]
        let slice = self
            .blob
            .slice_with_f64_and_f64(offset as f64, end as f64)
            .map_err(|e| io::Error::other(js_error(&e)))?;
        let bytes = reader
            .read_as_array_buffer(&slice)
            .map(|buffer| Uint8Array::new(&buffer))
            .map_err(|e| io::Error::other(js_error(&e)))?;
        let n = bytes.length() as usize;
        let dst = buf
            .get_mut(..n)
            .ok_or_else(|| io::Error::other("Blob.slice returned more bytes than requested"))?;
        bytes.copy_to(dst);
        Ok(n)
    }
}

/// The blob's size in bytes; 0 if the browser reports something that is not a size.
fn blob_size(blob: &Blob) -> u64 {
    let size = blob.size();
    if size.is_finite() && size >= 0.0 {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "checked non-negative and finite; sizes are integers below 2^53"
        )]
        let size = size as u64;
        size
    } else {
        0
    }
}

/// The `message` of a thrown JavaScript value, else its debug representation.
fn js_error(e: &JsValue) -> String {
    Reflect::get(e, &JsValue::from_str("message"))
        .ok()
        .and_then(|m| m.as_string())
        .unwrap_or_else(|| format!("{e:?}"))
}
