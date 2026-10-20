# Manga Reader

V0.2 local-first desktop comic/scan/manga reader: Tauri 2, React, strict TypeScript,
Vite, Bun and one Rust crate. Linux is the current build platform. Windows/macOS
compatibility is preserved in the design but has not been validated.

Reader can select one CBZ with a native picker, index its pages, display a single
page on demand, navigate with buttons or LTR arrow keys, replace it and close it.
Cancelling or failing a replacement preserves the current book. Switching screens
preserves the session/page; restarting the app does not. **Opening is not importing:**
Library still has no persistent collection and returns `[]` from Rust.

Static JPEG/PNG with ZIP Stored/Deflate are supported. No CBR/PDF/WebP, remote
sources, persistence, animated transitions, advanced zoom or installers.
See [architecture](docs/architecture.md) for precise limits, ordering, supported
ZIP variants, source/session contracts and resource ownership.

## Linux setup

Install Bun and stable Rust with rustfmt/Clippy, plus the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

Arch:

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf
```

Debian/Ubuntu:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev
```

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run dev:web` is a browser-only shell preview. Desktop IPC and the picker do
not work there; use the native application for reading.

Build the release frontend and native executable:

```sh
bun run build
```

Linux output: `src-tauri/target/release/manga-reader`. Bundling is disabled.
No production web server or Bun runtime is shipped.

## Checks and synthetic fixtures

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint
bun test
bun run typecheck:tests
bun run build:web
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
bun run build
```

`bun run check:rust` uses the same locked Clippy command. `bun run format` applies
Prettier/rustfmt. Tests are statically checked via `tsconfig.tests.json`; Bun alone
does not typecheck them. Frontend interaction tests use Happy DOM and React's act.
Rust tests generate tiny ZIP/image fixtures in temporary files and remove them.

For manual native testing, Python 3's standard library creates six tiny archives:

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v02
```

No downloads or real manga are needed. Follow the native release scenario in
[validation](docs/validation.md). Automated test success does not establish native
picker, CSP or WebView rendering success.

## Display limitation on this Linux machine

The V0.1 Wayland startup check failed with a GTK protocol error. A process-local
fallback is available without changing any system settings:

```sh
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run dev
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 src-tauri/target/release/manga-reader
```

A process staying alive is not a rendering or IPC test. Native interaction must
still be verified as described in the validation document. This workaround is
not baked into application code or made global.

## Dependencies

V0.1 dependencies are retained: `react`/`react-dom` for UI; `@tauri-apps/api` for IPC;
`typescript`, `@types/react`, `@types/react-dom` for static checks; `vite` and
`@vitejs/plugin-react` for the frontend pipeline; `@tauri-apps/cli` for native
orchestration; `eslint`, `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` for linting;
`prettier` for formatting; Rust `tauri`, `tauri-build`, `serde` for native runtime,
configuration and DTOs. TypeScript remains on the tooling-compatible 5.9 line.

Added for V0.2 only:

| Dependency                       | Purpose / enabled features                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Rust `rawzip` 0.5.2              | Bounded central-directory iteration, duplicate entries by position, CRC/size verification; std only |
| Rust `flate2` 1.1.10             | Deflate decoding; Rust backend, default features off                                                |
| Rust `image` 0.25.10             | Signature, dimensions and current-page decode validation; only JPEG/PNG                             |
| Rust `tauri-plugin-dialog` 2.8.3 | Rust-side native single-file selection; GTK3 backend, no JS plugin dependency or permission         |
| Rust `uuid` 1.28.0               | Opaque v4 operation/session/page/resource IDs; default features off                                 |
| Rust `serde_json` 1.0.154        | Small structured media-protocol error responses, never image bytes                                  |
| Dev `@types/bun` 1.4.3           | Typechecking Bun tests                                                                              |
| Dev `happy-dom` 21.0.3           | Lightweight DOM for actual React lifecycle/navigation tests                                         |

Both lockfiles are updated; existing packages were not generally upgraded.
The dialog plugin brings `rfd` and `tauri-plugin-fs` transitively, but no filesystem
plugin commands or scopes are exposed to the frontend. The initially evaluated
`zip` crate was replaced with `rawzip` because its filename map collapses duplicate
entries; `zip` and its extra encoder dependencies are absent from the final manifest.
