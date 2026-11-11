//! Parses every audio file under a directory the way the wasm build does and prints one JSON
//! line per file, then a summary on stderr.
//!
//! ```sh
//! cargo run --release --example scan -- ~/Music [--chunk-size BYTES] > scan.jsonl
//! ```
//!
//! Files are planned per directory with [`plan_batch`] (names only, no MIME types), read through
//! a [`Counting`] [`FileSource`], and parsed with [`parse_track`] using a fixed random value of
//! 0.5, so runs are repeatable. With `--chunk-size`, the read counts and errors come from a
//! second pass that parses only the tags through a [`ChunkedReader`] with that chunk size.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use localify_core::color::to_hex;
use localify_core::plan::plan_batch;
use localify_core::source::{ChunkedReader, Counting, DEFAULT_CHUNK_SIZE, FileSource, RangeSource};
use localify_core::tags::read_tags;
use localify_core::track::parse_track;
use serde_json::json;

#[derive(Default)]
struct FormatStats {
    files: u64,
    reads: Vec<u64>,
    bytes: Vec<u64>,
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut root = None;
    let mut chunk_size = DEFAULT_CHUNK_SIZE;
    while let Some(arg) = args.next() {
        if arg == "--chunk-size" {
            chunk_size = args
                .next()
                .and_then(|v| v.parse().ok())
                .filter(|&v| v > 0)
                .expect("--chunk-size takes a positive byte count");
        } else {
            root = Some(PathBuf::from(arg));
        }
    }
    let root = root.expect("usage: scan <directory> [--chunk-size BYTES]");

    let mut dirs = BTreeMap::new();
    collect(&root, &mut dirs);

    let mut stats: BTreeMap<String, FormatStats> = BTreeMap::new();
    let mut undecoded: BTreeMap<String, u64> = BTreeMap::new();
    let (mut total, mut errors, mut count) = (Duration::ZERO, 0, 0);
    for (dir, names) in &dirs {
        let types = vec![String::new(); names.len()];
        for entry in plan_batch(names, &types) {
            let Some(name) = names.get(entry.audio) else {
                continue;
            };
            let path = dir.join(name);
            let Ok(file) = FileSource::open(&path) else {
                eprintln!("can't open {}", path.display());
                continue;
            };
            let size = file.size();
            let mut source = Counting::new(file);
            let lyrics = entry
                .lyrics
                .and_then(|i| names.get(i))
                .and_then(|lrc| FileSource::open(dir.join(lrc)).ok());
            let start = Instant::now();
            let mut track = parse_track(name, &mut source, lyrics, 0.5);
            if chunk_size != DEFAULT_CHUNK_SIZE {
                // Count the reads of tag parsing alone with the requested chunk size.
                source = Counting::new(file_again(&path));
                let reader = ChunkedReader::with_chunk_size(&mut source, chunk_size);
                let ext = name.rsplit_once('.').map_or("", |(_, e)| e);
                track.error = read_tags(reader, ext).err().map(|e| e.to_string());
            }
            let elapsed = start.elapsed();
            total += elapsed;
            count += 1;

            let s = stats.entry(track.format.clone()).or_default();
            s.files += 1;
            s.reads.push(source.reads());
            s.bytes.push(source.bytes());
            if track.error.is_some() {
                errors += 1;
            }
            if track.cover_undecoded {
                let mime = track.cover.as_ref().map_or("", |c| c.mime.as_str());
                *undecoded.entry(mime.to_owned()).or_default() += 1;
            }
            let line = json!({
                "path": path,
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "format": track.format,
                "coverLength": track.cover.as_ref().map(|c| c.data.len()),
                "coverMime": track.cover.as_ref().map(|c| c.mime.as_str()),
                "coverUndecoded": track.cover_undecoded,
                "accentColor": to_hex(track.accent),
                "lyricsLength": track.lyrics.as_ref().map(String::len),
                "error": track.error,
                "micros": elapsed.as_micros(),
                "reads": source.reads(),
                "bytesRead": source.bytes(),
                "fileSize": size,
            });
            println!("{line}");
        }
    }

    eprintln!(
        "{count} files in {:.2} s ({errors} with errors), chunk size {chunk_size}",
        total.as_secs_f64()
    );
    eprintln!("undecoded covers: {undecoded:?}");
    for (format, s) in &mut stats {
        s.reads.sort_unstable();
        s.bytes.sort_unstable();
        let median = |v: &[u64]| v.get(v.len() / 2).copied().unwrap_or(0);
        let max = |v: &[u64]| v.last().copied().unwrap_or(0);
        eprintln!(
            "{format:>5}: {:4} files, range reads median {} max {}, bytes read median {} KiB max {} KiB",
            s.files,
            median(&s.reads),
            max(&s.reads),
            median(&s.bytes) / 1024,
            max(&s.bytes) / 1024,
        );
    }
}

fn file_again(path: &Path) -> FileSource {
    FileSource::open(path).expect("the file opened a moment ago")
}

/// Groups the regular files under `dir` by directory, names sorted.
fn collect(dir: &Path, out: &mut BTreeMap<PathBuf, Vec<String>>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect(&path, out),
            Ok(t) if t.is_file() => names.extend(entry.file_name().into_string().ok()),
            _ => {}
        }
    }
    names.sort();
    if !names.is_empty() {
        out.insert(dir.to_owned(), names);
    }
}
