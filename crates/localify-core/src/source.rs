//! Random-access reads of files that are too large or too slow to load whole.
//!
//! A [`RangeSource`] reads one byte range per call. [`ChunkedReader`] puts `Read + Seek` over a
//! source for parsers that issue many small reads: it serves small reads from a handful of
//! cached, chunk-aligned blocks and passes reads of a chunk or more (cover art, Ogg pages)
//! straight to the source as a single range read. Only the regions a parser touches are read.

use std::io::{self, Read, Seek, SeekFrom};

/// Something that can read an arbitrary byte range of a fixed-length file.
pub trait RangeSource {
    /// Total length of the file in bytes.
    fn size(&self) -> u64;

    /// Reads bytes starting at `offset` into `buf`, returning how many were read.
    ///
    /// Fills `buf` completely unless the range crosses the end of the file; then it reads up to
    /// the end, and returns 0 when `offset` is at or past it.
    ///
    /// # Errors
    /// Whatever the underlying file access reports.
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;
}

impl<S: RangeSource + ?Sized> RangeSource for &mut S {
    fn size(&self) -> u64 {
        (**self).size()
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        (**self).read_at(offset, buf)
    }
}

/// Reads the whole of `source` into memory, or `None` when it is larger than `max_len` bytes.
///
/// # Errors
/// Whatever the source reports.
pub fn read_all(mut source: impl RangeSource, max_len: usize) -> io::Result<Option<Vec<u8>>> {
    let Some(len) = usize::try_from(source.size())
        .ok()
        .filter(|&len| len <= max_len)
    else {
        return Ok(None);
    };
    let mut buf = vec![0; len];
    let n = source.read_at(0, &mut buf)?;
    buf.truncate(n);
    Ok(Some(buf))
}

/// Default chunk size of [`ChunkedReader`].
///
/// Each range read costs a `Blob.slice` and a `FileReaderSync` round trip in the browser, so
/// fewer, larger reads win as long as they don't pull in much audio. Measured over a library of
/// FLAC, M4A and Opus files, 256 KiB chunks need a median of 1 read per FLAC file, 3 per M4A and
/// 4 per Opus file (whose comment packet with an embedded cover spans many Ogg pages), against
/// 3, 4 and 15 reads with 64 KiB chunks, while the bytes read stay about the same.
pub const DEFAULT_CHUNK_SIZE: usize = 256 * 1024;

/// How many chunks [`ChunkedReader`] keeps. Parsers alternate between at most a few regions
/// (the start of a file, the end of a file, and the region being parsed), and 4 chunks of the
/// default size hold 1 MiB.
const CACHED_CHUNKS: usize = 4;

/// `Read + Seek` over a [`RangeSource`] that turns many small reads into few range reads.
pub struct ChunkedReader<S> {
    source: S,
    len: u64,
    pos: u64,
    chunk_size: usize,
    /// Least recently used first.
    chunks: Vec<Chunk>,
}

struct Chunk {
    start: u64,
    /// Shorter than the chunk size only for the file's last chunk.
    data: Vec<u8>,
}

impl<S: RangeSource> ChunkedReader<S> {
    /// Wraps `source` with [`DEFAULT_CHUNK_SIZE`] chunks. Allocates nothing until the first read.
    pub fn new(source: S) -> Self {
        Self::with_chunk_size(source, DEFAULT_CHUNK_SIZE)
    }

    /// Wraps `source` with chunks of `chunk_size` bytes.
    ///
    /// # Panics
    /// If `chunk_size` is 0.
    pub fn with_chunk_size(source: S, chunk_size: usize) -> Self {
        assert!(chunk_size > 0, "chunk size must be positive");
        Self {
            len: source.size(),
            source,
            pos: 0,
            chunk_size,
            chunks: Vec::with_capacity(CACHED_CHUNKS),
        }
    }

    /// Returns the cached chunk starting at `start`, reading it first if needed.
    fn chunk(&mut self, start: u64) -> io::Result<&[u8]> {
        let index = match self.chunks.iter().position(|c| c.start == start) {
            Some(index) => index,
            None => {
                let mut data = vec![0; self.chunk_size];
                let n = self.source.read_at(start, &mut data)?;
                data.truncate(n);
                if self.chunks.len() == CACHED_CHUNKS {
                    self.chunks.remove(0);
                }
                self.chunks.push(Chunk { start, data });
                self.chunks.len() - 1
            }
        };
        // Move the chunk to the most recently used end.
        let chunk = self.chunks.remove(index);
        self.chunks.push(chunk);
        Ok(self.chunks.last().map_or(&[], |c| c.data.as_slice()))
    }
}

impl<S: RangeSource> Read for ChunkedReader<S> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() || self.pos >= self.len {
            return Ok(0);
        }
        let n = if buf.len() >= self.chunk_size {
            self.source.read_at(self.pos, buf)?
        } else {
            // `chunk_size` fits in `usize` and the remainder is smaller, so neither conversion
            // can fail.
            let chunk_size = self.chunk_size as u64;
            let offset = self.pos % chunk_size;
            let start = self.pos - offset;
            let offset = usize::try_from(offset).expect("offset is below the chunk size");
            let available = self.chunk(start)?.get(offset..).unwrap_or_default();
            let n = available.len().min(buf.len());
            if let (Some(dst), Some(src)) = (buf.get_mut(..n), available.get(..n)) {
                dst.copy_from_slice(src);
            }
            n
        };
        self.pos = self.pos.saturating_add(n as u64);
        Ok(n)
    }
}

impl<S: RangeSource> Seek for ChunkedReader<S> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let target = match pos {
            SeekFrom::Start(offset) => Some(offset),
            SeekFrom::End(delta) => self.len.checked_add_signed(delta),
            SeekFrom::Current(delta) => self.pos.checked_add_signed(delta),
        };
        let target = target.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "seek to a negative or overflowing position",
            )
        })?;
        self.pos = target;
        Ok(target)
    }

    fn stream_position(&mut self) -> io::Result<u64> {
        Ok(self.pos)
    }
}

/// Wraps a [`RangeSource`] and counts its range reads and the bytes they returned.
pub struct Counting<S> {
    inner: S,
    reads: u64,
    bytes: u64,
}

impl<S> Counting<S> {
    /// Wraps `inner` with both counters at zero.
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            reads: 0,
            bytes: 0,
        }
    }

    /// Number of [`RangeSource::read_at`] calls so far.
    pub fn reads(&self) -> u64 {
        self.reads
    }

    /// Total bytes returned by those calls.
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
}

impl<S: RangeSource> RangeSource for Counting<S> {
    fn size(&self) -> u64 {
        self.inner.size()
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read_at(offset, buf)?;
        self.reads += 1;
        self.bytes += n as u64;
        Ok(n)
    }
}

/// A local file as a [`RangeSource`].
#[cfg(not(target_arch = "wasm32"))]
pub struct FileSource {
    file: std::fs::File,
    len: u64,
}

#[cfg(not(target_arch = "wasm32"))]
impl FileSource {
    /// Opens the file at `path` for reading.
    ///
    /// # Errors
    /// When the file can't be opened or its metadata read.
    pub fn open(path: impl AsRef<std::path::Path>) -> io::Result<Self> {
        let file = std::fs::File::open(path)?;
        let len = file.metadata()?.len();
        Ok(Self { file, len })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl RangeSource for FileSource {
    fn size(&self) -> u64 {
        self.len
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        self.file.seek(SeekFrom::Start(offset))?;
        let mut filled = 0;
        while let Some(rest) = buf.get_mut(filled..).filter(|rest| !rest.is_empty()) {
            match self.file.read(rest) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        Ok(filled)
    }
}

/// An in-memory file as a [`RangeSource`].
impl RangeSource for &[u8] {
    fn size(&self) -> u64 {
        self.len() as u64
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let src = usize::try_from(offset)
            .ok()
            .and_then(|offset| self.get(offset..))
            .unwrap_or_default();
        let n = src.len().min(buf.len());
        if let (Some(dst), Some(src)) = (buf.get_mut(..n), src.get(..n)) {
            dst.copy_from_slice(src);
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(len: usize) -> Vec<u8> {
        (0..len).map(|i| u8::try_from(i % 251).unwrap()).collect()
    }

    fn reader(data: &[u8], chunk: usize) -> ChunkedReader<Counting<&[u8]>> {
        ChunkedReader::with_chunk_size(Counting::new(data), chunk)
    }

    #[test]
    fn small_reads_share_one_chunk() {
        let d = data(100);
        let mut r = reader(&d, 16);
        let mut buf = [0; 4];
        for i in 0..4 {
            r.read_exact(&mut buf).unwrap();
            assert_eq!(buf, d[i * 4..i * 4 + 4]);
        }
        assert_eq!(r.source.reads(), 1);
        assert_eq!(r.source.bytes(), 16);
    }

    #[test]
    fn read_across_chunk_boundary() {
        let d = data(100);
        let mut r = reader(&d, 16);
        r.seek(SeekFrom::Start(14)).unwrap();
        let mut buf = [0; 6];
        r.read_exact(&mut buf).unwrap();
        assert_eq!(buf, d[14..20]);
        assert_eq!(r.source.reads(), 2);
        assert_eq!(r.stream_position().unwrap(), 20);
    }

    #[test]
    fn large_read_goes_straight_to_source() {
        let d = data(1000);
        let mut r = reader(&d, 16);
        let mut small = [0; 2];
        r.read_exact(&mut small).unwrap();
        let mut big = vec![0; 500];
        r.read_exact(&mut big).unwrap();
        assert_eq!(big, d[2..502]);
        assert_eq!(r.source.reads(), 2);
        assert_eq!(r.source.bytes(), 16 + 500);
    }

    #[test]
    fn seeks_and_cache_reuse() {
        let d = data(1000);
        let mut r = reader(&d, 16);
        let mut buf = [0; 3];
        r.seek(SeekFrom::End(-3)).unwrap();
        r.read_exact(&mut buf).unwrap();
        assert_eq!(buf, d[997..]);
        r.seek(SeekFrom::Start(0)).unwrap();
        r.read_exact(&mut buf).unwrap();
        assert_eq!(buf, d[..3]);
        r.seek(SeekFrom::Current(-2)).unwrap();
        r.read_exact(&mut buf).unwrap();
        assert_eq!(buf, d[1..4]);
        r.seek(SeekFrom::End(-1)).unwrap();
        r.read_exact(&mut buf[..1]).unwrap();
        assert_eq!(buf[0], d[999]);
        // Two distinct chunks, each read once.
        assert_eq!(r.source.reads(), 2);
    }

    #[test]
    fn evicts_least_recently_used() {
        let d = data(1000);
        let mut r = reader(&d, 10);
        let mut b = [0; 1];
        for start in [0, 100, 200, 300, 0, 400, 100] {
            r.seek(SeekFrom::Start(start as u64)).unwrap();
            r.read_exact(&mut b).unwrap();
            assert_eq!(b[0], d[start]);
        }
        // 0, 100, 200, 300 miss; 0 hits; 400 evicts 100; 100 misses again.
        assert_eq!(r.source.reads(), 6);
    }

    #[test]
    fn eof_and_bad_seeks() {
        let d = data(20);
        let mut r = reader(&d, 16);
        r.seek(SeekFrom::Start(18)).unwrap();
        let mut buf = [0; 8];
        assert_eq!(r.read(&mut buf).unwrap(), 2);
        assert_eq!(r.read(&mut buf).unwrap(), 0);
        r.seek(SeekFrom::Start(1000)).unwrap();
        assert_eq!(r.read(&mut buf).unwrap(), 0);
        assert!(r.read_exact(&mut buf).is_err());
        assert!(r.seek(SeekFrom::Current(-2000)).is_err());
        assert!(r.seek(SeekFrom::End(-21)).is_err());
        let mut all = Vec::new();
        r.seek(SeekFrom::Start(0)).unwrap();
        r.read_to_end(&mut all).unwrap();
        assert_eq!(all, d);
    }

    #[test]
    fn read_all_respects_cap() {
        let d = data(20);
        assert_eq!(read_all(&d[..], 20).unwrap(), Some(d.clone()));
        assert_eq!(read_all(&d[..], 19).unwrap(), None);
    }
}
