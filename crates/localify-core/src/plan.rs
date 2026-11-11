//! Picks the audio files out of a user's file selection and pairs each with a lyrics file.

/// Extensions treated as audio regardless of the browser-reported MIME type.
const AUDIO_EXTENSIONS: [&str; 6] = ["mp3", "wav", "ogg", "flac", "m4a", "opus"];

/// One audio file of a batch and its lyrics file, as indices into the planned names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    /// Index of the audio file.
    pub audio: usize,
    /// Index of the first `.lrc` file whose name contains the audio file's stem.
    pub lyrics: Option<usize>,
}

/// Plans a batch: the audio files in input order, each with its lyrics file.
///
/// `names[i]` and `types[i]` are a file's name and MIME type; a missing type counts as `""`.
///
/// A file is audio when its type starts with `audio/` or the text after the last `.` of its
/// name (the whole name without a `.`), lowercased, is one of mp3, wav, ogg, flac, m4a and opus.
/// The lyrics file is the first file whose lowercased name ends with `.lrc` and contains the
/// audio file's lowercased stem: the text before the last `.`, which must be followed by at least
/// one character. Without such a `.` there is no lyrics file.
///
/// Costs one lowercase pass over every name and a substring search of every `.lrc` name per
/// audio file.
pub fn plan_batch<S: AsRef<str>>(names: &[S], types: &[S]) -> Vec<Entry> {
    let lower: Vec<String> = names.iter().map(|n| n.as_ref().to_lowercase()).collect();
    let lyrics: Vec<(usize, &str)> = lower
        .iter()
        .enumerate()
        .filter(|(_, name)| name.ends_with(".lrc"))
        .map(|(i, name)| (i, name.as_str()))
        .collect();

    lower
        .iter()
        .enumerate()
        .filter(|&(i, name)| {
            let mime = types.get(i).map_or("", AsRef::as_ref);
            mime.starts_with("audio/") || is_audio_extension(name)
        })
        .map(|(audio, name)| Entry {
            audio,
            lyrics: stem(name).and_then(|stem| {
                lyrics
                    .iter()
                    .find(|(_, lrc)| lrc.contains(stem))
                    .map(|&(i, _)| i)
            }),
        })
        .collect()
}

fn is_audio_extension(lower_name: &str) -> bool {
    let ext = lower_name.rsplit('.').next().unwrap_or(lower_name);
    AUDIO_EXTENSIONS.contains(&ext)
}

/// The capture group of the JavaScript regex `/(.*)\.[^.]+$/` (unanchored, no flags).
///
/// The last `.` must be followed by at least one character. `.` in JavaScript does not match
/// line terminators, so the stem starts after the last line terminator before that `.`.
fn stem(name: &str) -> Option<&str> {
    let dot = name.rfind('.')?;
    if dot + 1 == name.len() {
        return None;
    }
    let before = name.get(..dot)?;
    let start = before
        .char_indices()
        .rev()
        .find(|&(_, c)| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        .map_or(0, |(i, c)| i + c.len_utf8());
    before.get(start..)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(files: &[(&str, &str)]) -> Vec<(usize, Option<usize>)> {
        let names: Vec<&str> = files.iter().map(|f| f.0).collect();
        let types: Vec<&str> = files.iter().map(|f| f.1).collect();
        plan_batch(&names, &types)
            .into_iter()
            .map(|e| (e.audio, e.lyrics))
            .collect()
    }

    #[test]
    fn detects_audio_by_type_or_extension() {
        let got = plan(&[
            ("a.MP3", ""),
            ("b.txt", "audio/x-custom"),
            ("c.txt", "text/plain"),
            ("d.Opus", "application/octet-stream"),
            ("flac", ""),
            ("e.aac", ""),
            ("f.lrc", ""),
        ]);
        assert_eq!(
            got,
            [(0, None), (1, None), (3, None), (4, None)],
            "a name without a dot is its own extension"
        );
    }

    #[test]
    fn pairs_lyrics_case_insensitively() {
        let got = plan(&[
            ("Song.flac", ""),
            ("other.lrc", ""),
            ("SONG.LRC", ""),
            ("song.lrc", ""),
        ]);
        assert_eq!(got, [(0, Some(2))]);
    }

    #[test]
    fn first_lrc_containing_the_stem_wins() {
        // "a" is a substring of "ab.lrc", which comes first.
        let got = plan(&[("a.mp3", ""), ("ab.lrc", ""), ("a.lrc", ""), ("ab.mp3", "")]);
        assert_eq!(got, [(0, Some(1)), (3, Some(1))]);
    }

    #[test]
    fn stem_is_everything_before_the_last_dot() {
        let got = plan(&[
            ("01. Artist - Title.live.m4a", ""),
            ("01. artist - title.lrc", ""),
            ("01. artist - title.live.lrc", ""),
        ]);
        assert_eq!(got, [(0, Some(2))]);
    }

    #[test]
    fn lrc_must_end_with_extension() {
        let got = plan(&[("x.wav", ""), ("x.lrc.bak", ""), ("x.lrc.txt", "")]);
        assert_eq!(got, [(0, None)]);
    }

    #[test]
    fn no_dot_means_no_lyrics() {
        let got = plan(&[("opus", ""), ("opus.lrc", "")]);
        assert_eq!(got, [(0, None)]);
    }

    #[test]
    fn empty_stem_matches_any_lrc() {
        let got = plan(&[(".flac", ""), ("z.lrc", "")]);
        assert_eq!(got, [(0, Some(1))]);
    }

    #[test]
    fn trailing_dot_audio_by_type() {
        // "a." has an empty extension: not audio by name, and the regex needs a character
        // after the dot, so no lyrics.
        assert_eq!(plan(&[("a.", "audio/mpeg"), ("a.lrc", "")]), [(0, None)]);
    }

    #[test]
    fn no_audio_and_missing_types() {
        assert!(plan(&[("a.lrc", ""), ("b.txt", "")]).is_empty());
        assert!(plan(&[]).is_empty());
        let names = ["a.mp3", "b.bin"];
        let types = ["", "audio/wav"];
        assert_eq!(plan_batch(&names, &types[..1]).len(), 1);
    }

    #[test]
    fn stem_matches_js_regex() {
        assert_eq!(stem("a.b.c"), Some("a.b"));
        assert_eq!(stem("abc"), None);
        assert_eq!(stem("abc."), None);
        assert_eq!(stem(".x"), Some(""));
        assert_eq!(stem("line1\nline2.mp3"), Some("line2"));
        assert_eq!(stem("x.y\nz"), Some("x"));
    }
}
