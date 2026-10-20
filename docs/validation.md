# V0.1 validation

Validated on Linux, 2026-10-20, using Bun 1.4.3 and Rust/Cargo 1.99.1.

- `bun add …`: installed the direct dependencies listed in README; TypeScript
  7 triggered peer warnings, so `bun add -d typescript@~5.9.3` resolved compatibility.
- `bun run format`: applied Prettier and rustfmt.
- `bun run format:check`: passed.
- `bun run lint`: passed with zero warnings.
- `bun test`: 3 passed, 9 assertions (empty navigation, endpoints/reset/close,
  invalid page counts).
- `bun run build`: passed; includes strict `tsc --noEmit`, Vite production build,
  and native release compilation. Initial sandbox attempt could not reach
  crates.io; the authorized network-enabled retry succeeded.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`:
  passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: passed; zero Rust unit
  tests currently, as the core only returns an empty catalog.
- `bun run tauri icon src-tauri/icons/source.svg --output src-tauri/icons`: generated
  native icons from the simple repository-owned SVG. Only desktop icons retained.
- `bun run dev:web`: started after authorizing localhost binding. Browser checks
  confirmed Home, Library's expected no-IPC error, Reader's disabled controls,
  and Settings.
- `timeout 8s src-tauri/target/release/manga-reader`: default Wayland startup failed
  with GDK protocol error 71. XWayland retry stayed alive but emitted GBM errors.
- `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 timeout 8s src-tauri/target/release/manga-reader`:
  stayed running until the intended timeout (124), without diagnostics. This is a
  startup check, not proof of native visual rendering or an end-to-end IPC test.

Native interactive validation and the default Wayland rendering problem remain
unresolved. Windows/macOS builds and installer packaging were not tested. The
workspace contains an empty, protected `.git` directory, not existing Git history;
no repository initialization or commit was attempted.
