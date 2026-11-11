//! Everything a queue row needs from an audio file and its optional lyrics file.

use crate::color::{self, CoverAccent, Rgb};
use crate::source::{self, ChunkedReader, RangeSource};
use crate::tags::{self, Picture};

/// Largest lyrics file read, in bytes. LRC files are a few KiB; anything this large is not one,
/// and reading it would grow wasm memory for good.
const MAX_LYRICS_BYTES: usize = 4 * 1024 * 1024;

/// Largest embedded cover passed on, in bytes; a larger picture is dropped as if the file had
/// none. Covers in a real library reach a few MiB, and every cover of a batch is kept in memory by
/// the page, so a picture this large is a crafted or broken file.
const MAX_COVER_BYTES: usize = 32 * 1024 * 1024;

/// A parsed track. Never partial: missing values are filled with fallbacks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Track {
    /// The title tag, else the file name without its last extension.
    pub title: String,
    /// The artist tag, else `Unknown Artist`.
    pub artist: String,
    /// The album tag, else `""`.
    pub album: String,
    /// The file name's extension, lowercased; `""` without one.
    pub format: String,
    /// The cover's accent, or [`color::DEFAULT_ACCENT`].
    pub accent: Rgb,
    /// The first embedded picture, unless it is larger than 32 MiB.
    pub cover: Option<Picture>,
    /// True when there is a cover that could not be decoded here (see [`CoverAccent::Undecoded`]).
    pub cover_undecoded: bool,
    /// The lyrics file's text without a leading BOM, trimmed.
    pub lyrics: Option<String>,
    /// Why the tags couldn't be read.
    pub error: Option<String>,
}

/// Parses the audio file `name` read through `audio`, and reads `lyrics` if given.
///
/// `random` in `[0, 1)` picks the accent among equally vivid candidates. Reads only the regions
/// of `audio` holding tags; reads `lyrics` whole when it is at most 4 MiB, else ignores it.
pub fn parse_track(
    name: &str,
    audio: impl RangeSource,
    lyrics: Option<impl RangeSource>,
    random: f64,
) -> Track {
    let format = extension(name).to_lowercase();
    let parsed = tags::read_tags(ChunkedReader::new(audio), &format);
    let (mut tags, error) = match parsed {
        Ok(tags) => (tags, None),
        Err(e) => (tags::Tags::default(), Some(error_chain(&e))),
    };
    tags.picture = tags
        .picture
        .filter(|picture| picture.data.len() <= MAX_COVER_BYTES);

    let (accent, cover_undecoded) = match &tags.picture {
        None => (color::DEFAULT_ACCENT, false),
        Some(picture) => match color::cover_accent(&picture.data, &picture.mime, random) {
            CoverAccent::Decoded(accent) => (accent.unwrap_or(color::DEFAULT_ACCENT), false),
            CoverAccent::Undecoded => (color::DEFAULT_ACCENT, true),
        },
    };

    Track {
        title: tags
            .title
            .unwrap_or_else(|| strip_extension(name).to_owned()),
        artist: tags.artist.unwrap_or_else(|| "Unknown Artist".to_owned()),
        album: tags.album.unwrap_or_default(),
        format,
        accent,
        cover: tags.picture,
        cover_undecoded,
        lyrics: lyrics.and_then(read_lyrics),
        error,
    }
}

/// The lyrics file decoded as UTF-8 (lossily), without a leading BOM, trimmed like JavaScript's
/// `String.prototype.trim`. `None` when reading fails or the file is over the size cap.
fn read_lyrics(source: impl RangeSource) -> Option<String> {
    let bytes = source::read_all(source, MAX_LYRICS_BYTES).ok()??;
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    Some(
        text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
            .to_owned(),
    )
}

/// `error` and its causes, joined with `: `.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

/// The text after the last `.`, or `""` without one.
fn extension(name: &str) -> &str {
    name.rsplit_once('.').map_or("", |(_, ext)| ext)
}

/// `name.replace(/\.[^.]+$/, '')`: drops the last `.` and what follows when that is not empty.
fn strip_extension(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() => stem,
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_helpers() {
        assert_eq!(extension("a.b.FLAC"), "FLAC");
        assert_eq!(extension("noext"), "");
        assert_eq!(extension("trailing."), "");
        assert_eq!(strip_extension("a.b.flac"), "a.b");
        assert_eq!(strip_extension("noext"), "noext");
        assert_eq!(strip_extension("trailing."), "trailing.");
        assert_eq!(strip_extension(".hidden"), "");
    }

    #[test]
    fn lyrics_are_decoded_and_trimmed() {
        let lrc = "\u{feff}\n [00:01.00] hi \r\n\u{feff}".as_bytes();
        assert_eq!(read_lyrics(lrc).as_deref(), Some("[00:01.00] hi"));
        assert_eq!(read_lyrics(&b"a\xffb"[..]).as_deref(), Some("a\u{fffd}b"));
    }

    /// An ID3v2.4 tag holding one `APIC` frame with a PNG signature followed by zeros, `len` bytes
    /// of picture in all.
    fn id3_with_cover(len: usize) -> Vec<u8> {
        let synchsafe = |n: usize| {
            let n = u32::try_from(n).unwrap();
            [n >> 21, n >> 14, n >> 7, n].map(|b| (b & 0x7f) as u8)
        };
        let mut picture = b"\x89PNG\r\n\x1a\n".to_vec();
        picture.resize(len, 0);
        // Text encoding, MIME type, picture type (front cover), empty description.
        let mut frame = b"\0image/png\0\x03\0".to_vec();
        frame.extend(picture);
        let mut tag = b"ID3\x04\0\0".to_vec();
        tag.extend(synchsafe(frame.len() + 10));
        tag.extend(b"APIC");
        tag.extend(synchsafe(frame.len()));
        tag.extend([0, 0]);
        tag.extend(frame);
        tag
    }

    #[test]
    fn oversized_cover_is_dropped() {
        let kept = parse_track("a.mp3", &id3_with_cover(64)[..], None::<&[u8]>, 0.0);
        assert_eq!(kept.cover.map(|c| c.data.len()), Some(64));

        let file = id3_with_cover(MAX_COVER_BYTES + 1);
        let dropped = parse_track("a.mp3", &file[..], None::<&[u8]>, 0.0);
        assert_eq!(dropped.cover, None);
        assert!(!dropped.cover_undecoded);
        assert_eq!(dropped.accent, color::DEFAULT_ACCENT);
        assert_eq!(dropped.error, None);
    }

    #[test]
    fn unreadable_audio_gets_fallbacks() {
        let track = parse_track(
            "My Song.final.mp3",
            &b"not audio"[..],
            Some(&b" words "[..]),
            0.0,
        );
        assert_eq!(track.title, "My Song.final");
        assert_eq!(track.artist, "Unknown Artist");
        assert_eq!(track.album, "");
        assert_eq!(track.format, "mp3");
        assert_eq!(track.accent, color::DEFAULT_ACCENT);
        assert_eq!(track.cover, None);
        assert!(!track.cover_undecoded);
        assert_eq!(track.lyrics.as_deref(), Some("words"));
        let error = track.error.unwrap();
        assert!(error.starts_with("failed to parse Mpeg file: "), "{error}");

        let track = parse_track("blob", &[][..], None::<&[u8]>, 0.0);
        assert_eq!(track.format, "");
        assert_eq!(track.title, "blob");
        assert!(track.error.is_some());
    }
}
