//! Title, artist, album and the first embedded picture of an audio file, read with `lofty`.
//!
//! The container is detected from the content, falling back to the file extension. Audio
//! properties are not read, so only the regions holding tags are touched. Each field takes the
//! first non-empty value across the file's tags, primary tag first; the picture is the first one
//! found in the same order. A file without an artist but with a list of artists (`ARTISTS` in
//! Vorbis comments, APE and MP4 freeform atoms, `TXXX:ARTISTS` in ID3v2) gets the list joined as
//! `A & B` or `A, B & C`.

use std::borrow::Cow;
use std::io::{Read, Seek};

use lofty::config::ParseOptions;
use lofty::error::FileParseError;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};

/// Tags read from an audio file. Empty values are `None`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Tags {
    /// Track title.
    pub title: Option<String>,
    /// Track artist.
    pub artist: Option<String>,
    /// Album title.
    pub album: Option<String>,
    /// The first embedded picture.
    pub picture: Option<Picture>,
}

/// An embedded picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    /// The encoded image.
    pub data: Vec<u8>,
    /// MIME type: sniffed from `data`, else the tag's declared type, else `image/jpeg`.
    pub mime: String,
}

/// Reads the tags of an audio file whose name ends in `.{extension}` (any case; `""` for none).
///
/// # Errors
/// When the container is not recognised from either the content or the extension, when reading
/// fails, or when the tags are malformed beyond what `lofty` tolerates.
pub fn read_tags<R: Read + Seek>(reader: R, extension: &str) -> Result<Tags, FileParseError> {
    let options = ParseOptions::new().read_properties(false);
    let probe = Probe::new(reader).options(options);
    let probe = match FileType::from_ext(extension) {
        Some(file_type) => probe.set_file_type(file_type),
        None => probe,
    };
    let mut file = probe.guess_file_type()?.read()?;
    Ok(collect(&mut file))
}

fn collect(file: &mut TaggedFile) -> Tags {
    let primary = file.primary_tag_type();
    let mut order: Vec<&Tag> = file.tags().iter().collect();
    // Stable sort: the primary tag first, the rest in file order.
    order.sort_by_key(|tag| tag.tag_type() != primary);

    let first = |get: fn(&Tag) -> Option<Cow<'_, str>>| {
        order
            .iter()
            .find_map(|tag| get(tag).filter(|v| !v.is_empty()).map(Cow::into_owned))
    };
    let title = first(|t| t.title());
    let artist = first(|t| t.artist()).or_else(|| order.iter().find_map(|tag| joined_artists(tag)));
    let album = first(|t| t.album());

    let picture_at = order
        .iter()
        .find_map(|tag| (!tag.pictures().is_empty()).then_some(tag.tag_type()));
    let picture = picture_at
        .and_then(|tag_type| file.tag_mut(tag_type))
        .map(|tag| {
            let picture = tag.remove_picture(0);
            let declared = picture.mime_type().map(|m| m.as_str().to_owned());
            let data = picture.into_data();
            let mime = image_mime(&data, declared.as_deref());
            Picture { data, mime }
        });

    Tags {
        title,
        artist,
        album,
        picture,
    }
}

/// The tag's list of artists as one string: `A`, `A & B` or `A, B & C`. `None` without one.
fn joined_artists(tag: &Tag) -> Option<String> {
    let artists: Vec<&str> = tag
        .get_strings(ItemKey::TrackArtists)
        .filter(|artist| !artist.is_empty())
        .collect();
    let (last, rest) = artists.split_last()?;
    Some(if rest.is_empty() {
        (*last).to_owned()
    } else {
        format!("{} & {last}", rest.join(", "))
    })
}

/// MIME type of an image: from its magic bytes, else the normalised `declared` type, else
/// `image/jpeg`.
pub fn image_mime(data: &[u8], declared: Option<&str>) -> String {
    if let Some(mime) = sniff(data) {
        return mime.to_owned();
    }
    declared
        .and_then(normalise_mime)
        .unwrap_or_else(|| "image/jpeg".to_owned())
}

fn sniff(data: &[u8]) -> Option<&'static str> {
    let mime = match data {
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => "image/png",
        [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => "image/gif",
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => "image/webp",
        [b'B', b'M', ..] => "image/bmp",
        [
            _,
            _,
            _,
            _,
            b'f',
            b't',
            b'y',
            b'p',
            b'a',
            b'v',
            b'i',
            b'f' | b's',
            ..,
        ] => "image/avif",
        _ => return None,
    };
    Some(mime)
}

/// Strips NULs and surrounding whitespace, lowercases, and turns a bare subtype (`jpg`, `png`)
/// into `image/…`. `None` when nothing is left.
fn normalise_mime(declared: &str) -> Option<String> {
    let clean: String = declared.chars().filter(|&c| c != '\0').collect();
    let clean = clean.trim().to_lowercase();
    let mime = match clean.as_str() {
        "" => return None,
        "jpg" | "jpeg" | "image/jpg" => "image/jpeg".to_owned(),
        s if s.contains('/') => clean,
        s => format!("image/{s}"),
    };
    Some(mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_artist_lists() {
        use lofty::tag::{ItemValue, TagItem, TagType};

        let mut tag = Tag::new(TagType::VorbisComments);
        let mut add = |artist: &str| {
            tag.push(TagItem::new(
                ItemKey::TrackArtists,
                ItemValue::Text(artist.to_owned()),
            ));
            joined_artists(&tag)
        };
        // Empty values are skipped.
        assert_eq!(add(""), None);
        assert_eq!(add("A").as_deref(), Some("A"));
        assert_eq!(add("B").as_deref(), Some("A & B"));
        assert_eq!(add("C").as_deref(), Some("A, B & C"));
    }

    #[test]
    fn sniffs_magic_bytes() {
        assert_eq!(
            image_mime(b"\xff\xd8\xff\xe0", Some("image/png")),
            "image/jpeg"
        );
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n", None), "image/png");
        assert_eq!(image_mime(b"GIF87a", None), "image/gif");
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 ", None), "image/webp");
        assert_eq!(image_mime(b"BM\0\0", None), "image/bmp");
        assert_eq!(image_mime(b"\0\0\0\x1cftypavif", None), "image/avif");
    }

    #[test]
    fn falls_back_to_declared_then_jpeg() {
        assert_eq!(image_mime(b"??", Some("PNG")), "image/png");
        assert_eq!(image_mime(b"??", Some(" jpg\0")), "image/jpeg");
        assert_eq!(image_mime(b"??", Some("image/JPG")), "image/jpeg");
        assert_eq!(image_mime(b"??", Some("Image/Tiff")), "image/tiff");
        assert_eq!(image_mime(b"??", Some("\0 \0")), "image/jpeg");
        assert_eq!(image_mime(&[], None), "image/jpeg");
    }
}
