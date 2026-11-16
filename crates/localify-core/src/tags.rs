//! Title, artist, album, release dates and the first embedded picture of an audio file, and how
//! its audio is stored, read with `lofty`.
//!
//! The container is detected from the content, falling back to the file extension. Besides the
//! regions holding tags, only the headers describing the audio stream are read. Each field takes
//! the first non-empty value across the file's tags, primary tag first; the picture is the first
//! one found in the same order. A file without an artist but with a list of artists (`ARTISTS` in
//! Vorbis comments, APE and MP4 freeform atoms, `TXXX:ARTISTS` in ID3v2) gets the list joined as
//! `A & B` or `A, B & C`.

use std::borrow::Cow;
use std::io::{Read, Seek};

use lofty::config::ParseOptions;
use lofty::error::{FileParseError, UnknownFormatError};
use lofty::file::{AudioFile, FileType, TaggedFile, TaggedFileExt};
use lofty::iff::wav::{WavFile, WavFormat};
use lofty::mp4::{Mp4Codec, Mp4File};
use lofty::mpeg::{Layer, MpegFile};
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
    /// When this release came out, as the tag spells it (usually `YYYY`, `YYYY-MM` or
    /// `YYYY-MM-DD`, possibly followed by a time): the release date, else the recording date
    /// (`DATE` in Vorbis comments, `TDRC` in ID3v2, `©day` in MP4), else the year.
    pub released: Option<String>,
    /// When the recording first came out, as the tag spells it: the original release date
    /// (`ORIGINALDATE`, `TDOR`).
    pub first_released: Option<String>,
    /// The first embedded picture.
    pub picture: Option<Picture>,
    /// How the audio is stored. `None` only in a default value.
    pub audio: Option<Audio>,
}

/// How a file stores its audio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Audio {
    /// The container's name, such as `Ogg` or `MPEG-4`.
    pub container: &'static str,
    /// The codec's name, such as `Opus` or `AAC`. `None` when the container can hold several
    /// codecs and the audio headers were unreadable or name one that isn't known here.
    pub codec: Option<&'static str>,
    /// The audio stream's average bitrate in kbit/s. `None` when the audio headers were
    /// unreadable or the stream is empty.
    pub bitrate: Option<u32>,
}

/// An embedded picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    /// The encoded image.
    pub data: Vec<u8>,
    /// MIME type: sniffed from `data`, else the tag's declared type, else `image/jpeg`.
    pub mime: String,
}

/// Reads the tags and audio details of an audio file whose name ends in `.{extension}` (any
/// case; `""` for none).
///
/// A file whose audio headers can't be read still gives its tags; `audio` then lacks the bitrate,
/// and the codec too unless the container implies it. That costs a second pass over the tags.
///
/// # Errors
/// When the container is not recognised from either the content or the extension, when reading
/// fails, or when the tags are malformed beyond what `lofty` tolerates.
pub fn read_tags<R: Read + Seek>(mut reader: R, extension: &str) -> Result<Tags, FileParseError> {
    let probe = Probe::new(&mut reader);
    let probe = match FileType::from_ext(extension) {
        Some(file_type) => probe.set_file_type(file_type),
        None => probe,
    };
    let file_type = probe
        .guess_file_type()?
        .file_type()
        .ok_or(UnknownFormatError)?;
    let (mut file, audio) = match read(&mut reader, file_type, true) {
        Ok(read) => read,
        // The tags matter more than the audio details, so this error gives way to the retry's.
        Err(_) => read(&mut reader, file_type, false)?,
    };
    Ok(collect(&mut file, audio))
}

/// Reads the file from its start, with its audio properties if `with_audio`.
fn read<R: Read + Seek>(
    reader: &mut R,
    file_type: FileType,
    with_audio: bool,
) -> Result<(TaggedFile, Audio), FileParseError> {
    reader.rewind()?;
    let options = ParseOptions::new().read_properties(with_audio);
    let (container, mut codec) = names(file_type);
    // These containers hold several codecs, which only their own property types name. Properties
    // that weren't read hold defaults, which name no codec for MP4 and a wrong one for the others.
    let file: TaggedFile = match file_type {
        FileType::Mp4 => {
            let file = Mp4File::read_from(reader, options)?;
            codec = file.properties().codec().and_then(mp4_codec);
            file.into()
        }
        FileType::Mpeg => {
            let file = MpegFile::read_from(reader, options)?;
            if with_audio {
                codec = Some(match file.properties().layer() {
                    Layer::Layer1 => "MP1",
                    Layer::Layer2 => "MP2",
                    Layer::Layer3 => "MP3",
                });
            }
            file.into()
        }
        FileType::Wav => {
            let file = WavFile::read_from(reader, options)?;
            if with_audio {
                codec = match file.properties().format() {
                    WavFormat::PCM => Some("PCM"),
                    WavFormat::IEEE_FLOAT => Some("PCM (float)"),
                    WavFormat::Other(_) => None,
                };
            }
            file.into()
        }
        _ => Probe::with_file_type(reader, file_type)
            .options(options)
            .read()?,
    };
    let bitrate = file.properties().audio_bitrate().filter(|&kbps| kbps > 0);
    Ok((
        file,
        Audio {
            container,
            codec,
            bitrate,
        },
    ))
}

/// The container's name, and the codec's when the container holds only one.
fn names(file_type: FileType) -> (&'static str, Option<&'static str>) {
    match file_type {
        FileType::Aac => ("ADTS", Some("AAC")),
        FileType::Aiff => ("AIFF", None),
        FileType::Ape => ("APE", Some("Monkey's Audio")),
        FileType::Flac => ("FLAC", Some("FLAC")),
        FileType::Mpeg => ("MPEG audio", None),
        FileType::Mp4 => ("MPEG-4", None),
        FileType::Mpc => ("Musepack", Some("Musepack")),
        FileType::Opus => ("Ogg", Some("Opus")),
        FileType::Vorbis => ("Ogg", Some("Vorbis")),
        FileType::Speex => ("Ogg", Some("Speex")),
        FileType::Wav => ("WAV", None),
        FileType::WavPack => ("WavPack", Some("WavPack")),
        // `FileType` is non-exhaustive, and custom types come only from resolvers, which this
        // crate doesn't register.
        _ => ("Unknown", None),
    }
}

fn mp4_codec(codec: Mp4Codec) -> Option<&'static str> {
    match codec {
        Mp4Codec::AAC => Some("AAC"),
        Mp4Codec::ALAC => Some("ALAC"),
        Mp4Codec::MP3 => Some("MP3"),
        Mp4Codec::FLAC => Some("FLAC"),
        // `Mp4Codec` is non-exhaustive.
        _ => None,
    }
}

fn collect(file: &mut TaggedFile, audio: Audio) -> Tags {
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
    let text = |key: ItemKey| {
        order.iter().find_map(|tag| {
            let value = tag.get_string(key)?.trim();
            (!value.is_empty()).then(|| value.to_owned())
        })
    };
    let released = text(ItemKey::ReleaseDate)
        .or_else(|| text(ItemKey::RecordingDate))
        .or_else(|| text(ItemKey::Year));
    let first_released = text(ItemKey::OriginalReleaseDate);

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
        released,
        first_released,
        picture,
        audio: Some(audio),
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
