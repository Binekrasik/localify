# localify-core

The WebAssembly library behind localify's file loading. It reads only the regions of an audio
file that hold tags (title, artist, album, first embedded picture; via `lofty`), decodes the
cover to pick the queue row's accent colour (JPEG with DCT-domain downscaling, PNG row by row),
and pairs picked audio files with `.lrc` lyrics files. It runs in a dedicated worker and reads
`File`s synchronously with `FileReaderSync`.

## Build

From the repository root:

```sh
bun run wasm
```

This builds the crate for `wasm32-unknown-unknown` (with SIMD128, see `.cargo/config.toml`) and
writes the `wasm-bindgen --target web` output to `src/lib/wasm/`. It needs Rust with the
`wasm32-unknown-unknown` target and the `wasm-bindgen` CLI at the version pinned in `Cargo.lock`.

Commit all four generated files in `src/lib/wasm/` whenever the crate, its dependencies, or its
build configuration changes. The web app's `bun run build` bundles these files without running
Rust, including on Vercel. `bun dev` rebuilds them before starting the development server.

## Test

From this directory:

```sh
cargo test
cargo clippy --all-targets
cargo clippy --target wasm32-unknown-unknown
```

The tag-parsing fixtures in `tests/fixtures/` come from `tests/fixtures/generate.sh`.

`examples/scan.rs` parses every audio file under a directory through the same code path as the
wasm build and prints one JSON line per file (tags, cover size and type, accent, error, timing,
range reads), with a per-format summary on stderr:

```sh
cargo run --release --example scan -- ~/Music > scan.jsonl
```
