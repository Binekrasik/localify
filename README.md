# localify

> [!WARNING]
> This is a hobby project. I do not guarantee any kind of maintenance or responsibility.

## Running
1. Install a Rust toolchain with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130:
   `rustup target add wasm32-unknown-unknown` and `cargo install wasm-bindgen-cli --version 0.2.130`
2. Clone the repo
3. `cd` into its directory
4. Install dependencies using `bun i` or `bun install`
5. Run `bun dev`, which also builds the WebAssembly module
6. Finally, localify should be available on `http://localhost:3000`
