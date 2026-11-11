// Builds crates/localify-core for wasm32 and generates its JavaScript bindings into src/lib/wasm.
// Run from anywhere with `bun scripts/build-wasm.ts`; exits non-zero on any failure.

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const crate = join(root, 'crates/localify-core')
const target = 'wasm32-unknown-unknown'
const outDir = join(root, 'src/lib/wasm')
const outputs = ['localify_core.js', 'localify_core.d.ts', 'localify_core_bg.wasm', 'localify_core_bg.wasm.d.ts']
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin')

function fail(message: string): never {
    console.error(`build-wasm: ${message}`)
    process.exit(1)
}

function which(tool: string, hint: string): string {
    const path = Bun.which(tool) ?? Bun.which(tool, { PATH: cargoBin })
    if (!path) fail(`\`${tool}\` not found. ${hint}`)
    return path
}

const rustup = 'Install Rust from https://rustup.rs.'

/** Runs a command; returns its stdout, or exits with its stderr when it fails. */
function run(cmd: string[], cwd = crate, inherit = false): string {
    const result = Bun.spawnSync(cmd, { cwd, stdout: inherit ? 'inherit' : 'pipe', stderr: inherit ? 'inherit' : 'pipe' })
    if (result.exitCode !== 0) fail(`\`${cmd.join(' ')}\` failed${inherit ? '' : `:\n${result.stderr.toString()}`}`)
    return result.stdout?.toString() ?? ''
}

const cargo = which('cargo', rustup)
const libdir = run([which('rustc', rustup), '--print', 'target-libdir', '--target', target]).trim()
if (!existsSync(libdir)) fail(`the ${target} target is not installed. Run \`rustup target add ${target}\`.`)

// The CLI must match the wasm-bindgen crate version locked in Cargo.lock exactly.
const lock = await Bun.file(join(crate, 'Cargo.lock')).text()
const pinned = lock.match(/\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1]
if (!pinned) fail('no wasm-bindgen entry in crates/localify-core/Cargo.lock.')
const install = `Run \`cargo install wasm-bindgen-cli --version ${pinned} --locked\`.`
const bindgen = which('wasm-bindgen', install)
const version = run([bindgen, '--version']).trim().split(' ')[1]
if (version !== pinned) fail(`wasm-bindgen ${version} found, but Cargo.lock pins ${pinned}. ${install}`)

// Run from the crate directory so cargo picks up its .cargo/config.toml (SIMD128, memory limit).
run([cargo, 'build', '--release', '--locked', '--target', target], crate, true)

// Cargo's target directory follows CARGO_TARGET_DIR and `build.target-dir`.
const metadata = JSON.parse(run([cargo, 'metadata', '--format-version', '1', '--no-deps', '--locked']))
const wasm = join(metadata.target_directory, target, 'release/localify_core.wasm')
const built = statSync(wasm).mtimeMs
const upToDate = outputs.every(name => {
    const path = join(outDir, name)
    return existsSync(path) && statSync(path).mtimeMs >= built
})
if (!upToDate) {
    run([bindgen, '--target', 'web', '--remove-name-section', '--remove-producers-section', '--out-dir', outDir, wasm])
    console.log(`build-wasm: wrote ${outDir} (${(statSync(join(outDir, 'localify_core_bg.wasm')).size / 1024).toFixed(0)} KiB wasm)`)
}
