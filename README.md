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

## Production build and deployment

The repository includes the precompiled WebAssembly module and its JavaScript and TypeScript
bindings in `src/lib/wasm/`. `bun run build` type-checks the app and bundles it with Vite into
`dist/`, without invoking Rust. `bun run typecheck` also uses the precompiled bindings.

On Vercel, use the Vite framework preset, `bun run build` as the build command, and `dist` as
the output directory. Rust is not required on the deployment machine.

After changing the Rust crate, its dependencies, or its build configuration, run `bun run wasm`
locally with the Rust tools installed, then `bun run build`. Commit all four generated files in
`src/lib/wasm/` together with the source changes so deployments use the matching module and bindings.
