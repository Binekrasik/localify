//! Accent colour of a cover image.
//!
//! The image is reduced to a grid of at most 100 × 100 cells by averaging the pixels each cell
//! covers (alpha-weighted, like a canvas downscale). Walking the grid row-major, every 5th cell
//! is considered: cells with alpha below 128 are skipped, as are cells whose saturation
//! (`max - min` of the channels) is below 35, whose brightest channel is below 40, or whose
//! darkest channel is above 200. Candidates are kept in a pool: a cell whose saturation exceeds
//! the pool's peak by more than 20 replaces the pool and becomes its peak, and a cell within 20
//! of the peak joins it. The accent is one pool member picked with a caller-supplied random
//! number; an empty pool gives [`DEFAULT_ACCENT`].
//!
//! Decoding reads rows in order and never holds more than one grid row of sums, so memory stays
//! small apart from the decoder's own buffers. JPEG is decoded with DCT-domain downscaling to the
//! smallest size that still covers the grid. Interlaced PNGs and formats without a decoder here
//! are reported as [`CoverAccent::Undecoded`] for the caller to decode another way.

use std::io::Cursor;

/// An sRGB colour.
pub type Rgb = [u8; 3];

/// The accent used when no pixel qualifies or the image can't be decoded.
pub const DEFAULT_ACCENT: Rgb = [0x70, 0x50, 0xfd];

/// Grid cells per side, at most.
const GRID: u32 = 100;
/// Every `STEP`th grid cell, in row-major order, is considered.
const STEP: u32 = 5;

/// Largest image, in source pixels, decoded here.
///
/// A progressive JPEG keeps 2 bytes of coefficients per sample for the whole image before any
/// downscaling, and wasm memory never shrinks once grown, so a 4096 × 4096 cover can cost up to
/// 96 MiB. Larger covers are left to the caller (the browser's decoder lives outside the wasm
/// heap).
const MAX_PIXELS: u64 = 4096 * 4096;

/// Cap on the decoders' allocations.
const MAX_DECODER_BYTES: usize = 128 * 1024 * 1024;

/// Result of extracting the accent from an encoded cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoverAccent {
    /// The cover was decoded; `None` when no pixel qualified.
    Decoded(Option<Rgb>),
    /// The cover could not be decoded here: an unsupported format, an interlaced PNG, an image
    /// larger than 4096 × 4096 pixels, or data the decoder rejected.
    Undecoded,
}

/// Formats `color` as `#rrggbb`.
pub fn to_hex([r, g, b]: Rgb) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Accent colour of an encoded image whose MIME type is `mime`.
///
/// `random` in `[0, 1)` picks among the candidates (values outside are clamped).
pub fn cover_accent(data: &[u8], mime: &str, random: f64) -> CoverAccent {
    let pixels = match mime {
        "image/jpeg" => decode_jpeg(data),
        "image/png" => decode_png(data),
        _ => None,
    };
    match pixels {
        Some(sampler) => CoverAccent::Decoded(sampler.finish(random)),
        None => CoverAccent::Undecoded,
    }
}

/// Accent colour of `width × height` RGBA pixels, row-major without padding.
///
/// Returns [`DEFAULT_ACCENT`] when no pixel qualifies or `pixels` is shorter than the
/// dimensions require; extra bytes are ignored. `random` is as for [`cover_accent`].
pub fn accent_from_rgba(pixels: &[u8], width: u32, height: u32, random: f64) -> Rgb {
    let Some(row_len) = usize::try_from(width).ok().and_then(|w| w.checked_mul(4)) else {
        return DEFAULT_ACCENT;
    };
    let needed = usize::try_from(height)
        .ok()
        .and_then(|h| h.checked_mul(row_len));
    if row_len == 0 || needed.is_none_or(|n| n > pixels.len()) {
        return DEFAULT_ACCENT;
    }
    let Some(mut sampler) = GridSampler::new(width, height, Layout::Rgba) else {
        return DEFAULT_ACCENT;
    };
    for row in pixels.chunks_exact(row_len).take(height as usize) {
        sampler.push_row(row);
    }
    sampler.finish(random).unwrap_or(DEFAULT_ACCENT)
}

fn decode_jpeg(data: &[u8]) -> Option<GridSampler> {
    let mut decoder = jpeg_decoder::Decoder::new(data);
    decoder.set_max_decoding_buffer_size(MAX_DECODER_BYTES);
    // Reads the headers; a request no reduced scale can meet keeps the full size and reports it.
    let (full_w, full_h) = decoder.scale(u16::MAX, u16::MAX).ok()?;
    if u64::from(full_w) * u64::from(full_h) > MAX_PIXELS {
        return None;
    }
    let (w, h) = scale_jpeg(&mut decoder, full_w, full_h)?;
    let pixels = decoder.decode().ok()?;
    let (w, h) = (u32::from(w), u32::from(h));
    let area = usize::try_from(w * h).ok().filter(|&a| a > 0)?;
    let layout = match pixels.len() / area {
        // L8 and L16: grey has no saturation, so no pixel can qualify.
        1 | 2 => return GridSampler::new(w, h, Layout::Gray),
        3 => Layout::Rgb,
        4 => Layout::Cmyk,
        _ => return None,
    };
    let mut sampler = GridSampler::new(w, h, layout)?;
    let row_len = usize::try_from(w).ok()? * layout.bytes_per_pixel();
    for row in pixels.chunks_exact(row_len).take(h as usize) {
        sampler.push_row(row);
    }
    Some(sampler)
}

/// Sets the smallest DCT scale (1/8, 1/4, 1/2 or 1) whose output covers the sampling grid on
/// both axes, returning the output size.
fn scale_jpeg(decoder: &mut jpeg_decoder::Decoder<&[u8]>, w: u16, h: u16) -> Option<(u16, u16)> {
    let scaled = |len: u16, eighths: u32| (u32::from(len) * eighths).div_ceil(8);
    let need = |len: u16| u32::from(len).min(GRID);
    let eighths = [1, 2, 4, 8]
        .into_iter()
        .find(|&e| scaled(w, e) >= need(w) && scaled(h, e) >= need(h))
        .unwrap_or(8);
    // `Decoder::scale` picks the smallest scale meeting the request on either axis, so request
    // only the axis that needs the largest scale and an unreachable size on the other.
    let width_needs = [1, 2, 4, 8]
        .into_iter()
        .find(|&e| scaled(w, e) >= need(w))
        .unwrap_or(8);
    let request = if width_needs == eighths {
        (u16::try_from(scaled(w, eighths)).ok()?, u16::MAX)
    } else {
        (u16::MAX, u16::try_from(scaled(h, eighths)).ok()?)
    };
    decoder.scale(request.0, request.1).ok()
}

fn decode_png(data: &[u8]) -> Option<GridSampler> {
    let limits = png::Limits {
        bytes: MAX_DECODER_BYTES,
    };
    let mut decoder = png::Decoder::new_with_limits(Cursor::new(data), limits);
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    // A corrupt image only skews the accent; skipping CRC and Adler-32 saves about 6% of the
    // decode time of a typical 2000 × 2000 cover.
    decoder.ignore_checksums(true);
    let mut reader = decoder.read_info().ok()?;
    let info = reader.info();
    let (w, h) = (info.width, info.height);
    if info.interlaced || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return None;
    }
    let layout = match reader.output_color_type().0 {
        png::ColorType::Grayscale => Layout::Gray,
        png::ColorType::GrayscaleAlpha => Layout::GrayAlpha,
        png::ColorType::Rgb => Layout::Rgb,
        png::ColorType::Rgba => Layout::Rgba,
        // EXPAND turns indexed images into RGB(A).
        png::ColorType::Indexed => return None,
    };
    let mut sampler = GridSampler::new(w, h, layout)?;
    let row_len = usize::try_from(w).ok()? * layout.bytes_per_pixel();
    while let Some(row) = reader.next_row().ok()? {
        let row = row.data().get(..row_len)?;
        sampler.push_row(row);
    }
    (sampler.rows_seen == h).then_some(sampler)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Layout {
    Gray,
    GrayAlpha,
    Rgb,
    Rgba,
    /// CMYK ink amounts (0 = no ink), as `jpeg-decoder` outputs them.
    Cmyk,
}

impl Layout {
    fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Gray => 1,
            Self::GrayAlpha => 2,
            Self::Rgb => 3,
            Self::Rgba | Self::Cmyk => 4,
        }
    }

    /// The pixel as RGBA. `px` has exactly `bytes_per_pixel` bytes.
    fn rgba(self, px: &[u8]) -> [u8; 4] {
        match (self, px) {
            (Self::Gray, &[l]) => [l, l, l, 255],
            (Self::GrayAlpha, &[l, a]) => [l, l, l, a],
            (Self::Rgb, &[r, g, b]) => [r, g, b, 255],
            (Self::Rgba, &[r, g, b, a]) => [r, g, b, a],
            (Self::Cmyk, &[c, m, y, k]) => {
                let white = u16::from(255 - k);
                let mul = |ink: u8| u8::try_from(u16::from(255 - ink) * white / 255).unwrap_or(255);
                [mul(c), mul(m), mul(y), 255]
            }
            _ => [0; 4],
        }
    }
}

/// Reduces rows of an image, pushed top to bottom, to the sampled grid cells and feeds them to a
/// [`Picker`] in row-major order.
struct GridSampler {
    width: u32,
    height: u32,
    grid_w: u32,
    grid_h: u32,
    layout: Layout,
    /// Grid row the sums belong to.
    grid_y: u32,
    /// Alpha-weighted channel sums and alpha sum of each cell of the current grid row; only the
    /// sampled cells are filled.
    sums: Vec<[u64; 4]>,
    /// Source rows added to the sums of the current grid row.
    cell_rows: u64,
    rows_seen: u32,
    picker: Picker,
}

impl GridSampler {
    /// `None` when either dimension is 0.
    fn new(width: u32, height: u32, layout: Layout) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }
        let grid_w = width.min(GRID);
        Some(Self {
            width,
            height,
            grid_w,
            grid_h: height.min(GRID),
            layout,
            grid_y: 0,
            sums: vec![[0; 4]; grid_w as usize],
            cell_rows: 0,
            rows_seen: 0,
            picker: Picker::default(),
        })
    }

    /// Grid cell index covering source coordinate `pos` of a `len`-long axis split into `cells`.
    fn cell(pos: u32, len: u32, cells: u32) -> u32 {
        // pos < len, so the quotient is below `cells`.
        u32::try_from(u64::from(pos) * u64::from(cells) / u64::from(len)).unwrap_or(cells - 1)
    }

    /// First source coordinate of grid cell `cell`.
    fn start(cell: u32, len: u32, cells: u32) -> usize {
        usize::try_from(u64::from(cell) * u64::from(len) / u64::from(cells)).unwrap_or(usize::MAX)
    }

    /// Columns of the grid row `grid_y` that are sampled: global cell index divisible by `STEP`.
    fn sampled_columns(&self, grid_y: u32) -> impl Iterator<Item = u32> + use<> {
        let first = (STEP - grid_y * self.grid_w % STEP) % STEP;
        (first..self.grid_w).step_by(STEP as usize)
    }

    /// Adds the next row; rows past the image height are ignored.
    fn push_row(&mut self, row: &[u8]) {
        if self.rows_seen >= self.height {
            return;
        }
        let grid_y = Self::cell(self.rows_seen, self.height, self.grid_h);
        if grid_y != self.grid_y {
            self.flush();
            self.grid_y = grid_y;
        }
        self.rows_seen += 1;
        self.cell_rows += 1;

        let bpp = self.layout.bytes_per_pixel();
        for gx in self.sampled_columns(grid_y) {
            let x0 = Self::start(gx, self.width, self.grid_w);
            let x1 = Self::start(gx + 1, self.width, self.grid_w);
            let bytes = row
                .get(x0.saturating_mul(bpp)..x1.saturating_mul(bpp))
                .unwrap_or_default();
            let Some(sum) = self.sums.get_mut(gx as usize) else {
                continue;
            };
            for px in bytes.chunks_exact(bpp) {
                let [r, g, b, a] = self.layout.rgba(px).map(u64::from);
                sum[0] += r * a;
                sum[1] += g * a;
                sum[2] += b * a;
                sum[3] += a;
            }
        }
    }

    /// Feeds the sampled cells of the current grid row to the picker and clears the sums.
    fn flush(&mut self) {
        let rows = std::mem::take(&mut self.cell_rows).max(1);
        for gx in self.sampled_columns(self.grid_y) {
            let x0 = Self::start(gx, self.width, self.grid_w) as u64;
            let x1 = Self::start(gx + 1, self.width, self.grid_w) as u64;
            let count = rows * x1.saturating_sub(x0).max(1);
            let Some(sum) = self.sums.get_mut(gx as usize) else {
                continue;
            };
            let [r, g, b, a] = std::mem::take(sum);
            let channel = |v: u64| u8::try_from((v + a / 2) / a.max(1)).unwrap_or(255);
            let alpha = u8::try_from((a + count / 2) / count).unwrap_or(255);
            self.picker
                .push([channel(r), channel(g), channel(b), alpha]);
        }
    }

    /// Picks the accent; `None` when no cell qualified.
    fn finish(mut self, random: f64) -> Option<Rgb> {
        if self.rows_seen > 0 {
            self.flush();
        }
        self.picker.pick(random)
    }
}

/// The candidate pool of the module docs.
#[derive(Default)]
struct Picker {
    candidates: Vec<Rgb>,
    /// Saturation of the pool's peak; `None` before the first candidate.
    peak: Option<u8>,
}

impl Picker {
    fn push(&mut self, [r, g, b, a]: [u8; 4]) {
        if a < 128 {
            return;
        }
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let sat = max - min;
        if sat < 35 || max < 40 || min > 200 {
            return;
        }
        let peak = self.peak.map_or(-1, i16::from);
        let sat16 = i16::from(sat);
        if sat16 > peak + 20 {
            self.peak = Some(sat);
            self.candidates.clear();
            self.candidates.push([r, g, b]);
        } else if sat16 >= peak - 20 {
            self.candidates.push([r, g, b]);
        }
    }

    fn pick(&self, random: f64) -> Option<Rgb> {
        let len = self.candidates.len();
        // A float-to-int `as` saturates and maps NaN to 0, so the index stays in range after
        // `min`.
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "saturating float-to-int conversion is the intent"
        )]
        let index = ((random.clamp(0.0, 1.0) * len as f64) as usize).min(len.checked_sub(1)?);
        self.candidates.get(index).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picker(pixels: &[[u8; 4]]) -> Picker {
        let mut p = Picker::default();
        for &px in pixels {
            p.push(px);
        }
        p
    }

    #[test]
    fn filters_dull_dark_bright_and_transparent() {
        let p = picker(&[
            [255, 0, 0, 127],     // transparent
            [100, 80, 70, 255],   // sat 30
            [39, 0, 0, 255],      // max < 40
            [255, 201, 240, 255], // min > 200
        ]);
        assert!(p.candidates.is_empty());
        assert_eq!(p.pick(0.5), None);
    }

    #[test]
    fn pool_resets_on_much_higher_saturation() {
        let p = picker(&[
            [100, 50, 50, 255],   // sat 50: first, peak 50
            [110, 50, 50, 255],   // sat 60: within 20 above, joins; peak stays 50
            [140, 50, 50, 255],   // sat 90: > 50 + 20, resets; peak 90
            [100, 30, 30, 255],   // sat 70: >= 90 - 20, joins
            [100, 31, 31, 255],   // sat 69: below 70, skipped
            [255, 145, 145, 128], // sat 110: = 90 + 20, joins without reset
        ]);
        assert_eq!(p.peak, Some(90));
        assert_eq!(
            p.candidates,
            [[140, 50, 50], [100, 30, 30], [255, 145, 145]]
        );
    }

    #[test]
    fn random_selects_index() {
        let p = picker(&[[200, 0, 0, 255], [0, 200, 0, 255], [0, 0, 200, 255]]);
        assert_eq!(p.pick(0.0), Some([200, 0, 0]));
        assert_eq!(p.pick(0.34), Some([0, 200, 0]));
        assert_eq!(p.pick(0.999), Some([0, 0, 200]));
        assert_eq!(p.pick(1.0), Some([0, 0, 200]));
        assert_eq!(p.pick(f64::NAN), Some([200, 0, 0]));
        assert_eq!(p.pick(-3.0), Some([200, 0, 0]));
    }

    #[test]
    fn hex() {
        assert_eq!(to_hex(DEFAULT_ACCENT), "#7050fd");
        assert_eq!(to_hex([0, 15, 255]), "#000fff");
    }

    /// `w × h` RGBA image filled by `f(x, y)`.
    fn image(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let f = &f;
        (0..h)
            .flat_map(|y| (0..w).flat_map(move |x| f(x, y)))
            .collect()
    }

    #[test]
    fn small_image_samples_every_fifth_pixel() {
        // 7 × 3: pixels 0, 5, 10, 15, 20 are sampled. Only pixel 10 (x 3, y 1) is vivid.
        let img = image(7, 3, |x, y| {
            if (x, y) == (3, 1) {
                [10, 200, 30, 255]
            } else if (x, y) == (4, 1) {
                [255, 0, 0, 255] // vivid but not sampled
            } else {
                [128, 128, 128, 255]
            }
        });
        assert_eq!(accent_from_rgba(&img, 7, 3, 0.7), [10, 200, 30]);
    }

    #[test]
    fn large_image_averages_cells() {
        // 200 × 200 with 2 × 2 cells: each cell is half red, half blue per column pair.
        let img = image(200, 200, |x, _| {
            if x % 2 == 0 {
                [200, 0, 0, 255]
            } else {
                [0, 0, 200, 255]
            }
        });
        assert_eq!(accent_from_rgba(&img, 200, 200, 0.0), [100, 0, 100]);
    }

    #[test]
    fn transparent_pixels_do_not_tint_the_average() {
        let img = image(200, 200, |x, _| {
            if x % 2 == 0 {
                [200, 0, 0, 255]
            } else {
                [0, 0, 200, 0]
            }
        });
        // Alpha averages to 128 and the colour comes only from the opaque half.
        assert_eq!(accent_from_rgba(&img, 200, 200, 0.0), [200, 0, 0]);
        let clear = image(10, 10, |_, _| [255, 0, 0, 100]);
        assert_eq!(accent_from_rgba(&clear, 10, 10, 0.0), DEFAULT_ACCENT);
    }

    #[test]
    fn alpha_is_averaged_over_the_rows_of_a_cell() {
        // 150 rows on a 100-row grid: cells hold one or two rows.
        let img = image(150, 150, |_, _| [200, 0, 0, 200]);
        let mut sampler = GridSampler::new(150, 150, Layout::Rgba).unwrap();
        for row in img.as_chunks::<{ 150 * 4 }>().0 {
            sampler.push_row(row);
        }
        sampler.flush();
        // Every sampled cell has alpha 200 and qualifies.
        assert_eq!(sampler.picker.candidates.len(), 100 * 100 / 5);
    }

    #[test]
    fn rejects_bad_dimensions() {
        let img = image(4, 4, |_, _| [255, 0, 0, 255]);
        assert_eq!(accent_from_rgba(&img, 4, 4, 0.0), [255, 0, 0]);
        assert_eq!(accent_from_rgba(&img, 4, 5, 0.0), DEFAULT_ACCENT);
        assert_eq!(accent_from_rgba(&img, 0, 4, 0.0), DEFAULT_ACCENT);
        assert_eq!(
            accent_from_rgba(&img, u32::MAX, u32::MAX, 0.0),
            DEFAULT_ACCENT
        );
        assert_eq!(accent_from_rgba(&[], 1, 1, 0.0), DEFAULT_ACCENT);
    }

    #[test]
    fn sampled_columns_follow_global_index() {
        let s = GridSampler::new(7, 3, Layout::Rgba).unwrap();
        assert_eq!(s.sampled_columns(0).collect::<Vec<_>>(), [0, 5]);
        assert_eq!(s.sampled_columns(1).collect::<Vec<_>>(), [3]);
        assert_eq!(s.sampled_columns(2).collect::<Vec<_>>(), [1, 6]);
    }

    #[test]
    fn garbage_is_undecoded() {
        assert_eq!(
            cover_accent(b"\xff\xd8\xff garbage", "image/jpeg", 0.0),
            CoverAccent::Undecoded
        );
        assert_eq!(
            cover_accent(b"\x89PNG\r\n\x1a\nxx", "image/png", 0.0),
            CoverAccent::Undecoded
        );
        assert_eq!(
            cover_accent(b"GIF89a", "image/gif", 0.0),
            CoverAccent::Undecoded
        );
        assert_eq!(cover_accent(&[], "image/jpeg", 0.0), CoverAccent::Undecoded);
    }
}
