//! File loading, tag parsing and accent-colour extraction for localify's queue.
//!
//! The core is target-independent and tested natively. On `wasm32` the `wasm` module exposes
//! it to JavaScript through `wasm-bindgen`; it runs in a dedicated worker, where files are read
//! synchronously with `FileReaderSync`.
//!
//! File contents are untrusted. This crate's own code validates lengths, checks arithmetic and
//! caps the allocations it makes from them. Container and image parsing is done by `lofty`,
//! `jpeg-decoder` and `png`, which can still exhaust the stack or the heap on a crafted file (ID3v2
//! chapter frames nested thousands deep, a compressed ID3v2 frame that inflates without end). The
//! wasm build therefore limits its memory to 512 MiB (`.cargo/config.toml`), so such a file ends
//! in a trap instead of unbounded growth. A trap leaves the instance unusable: the caller must
//! discard it.

pub mod color;
pub mod plan;
pub mod source;
pub mod tags;
pub mod track;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
