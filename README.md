# Manga Reader

V0.6 local-first desktop comic/scan/manga reader: Tauri 2, React, strict TypeScript,
Vite, Bun and one Rust crate. Linux is the current build platform. Windows/macOS
compatibility is preserved in the design but has not been validated.

Reader can select one CBZ with a native picker, index its pages, display a single
page or double-page spread on demand, navigate with buttons or LTR/RTL arrow keys,
jump to a page number, replace it and close it.
Cancelling or failing a replacement preserves the current book. Switching screens
preserves the session/page. **Open CBZ is temporary; Add Books imports persistently.**
Library supports multiple native CBZ selections, duplicate detection, availability
checks, metadata-only removal and experimental Grid/Shelf renderers. SQLite retains books and reading progress across
restarts; opening a Library or Home Continue Reading card resumes the saved page.
The active Reader session itself is not automatically restored on startup.

Static JPEG/PNG with ZIP Stored/Deflate are supported. No CBR/PDF/WebP, remote
sources, animated transitions or installers. Persistent Library imports generate
small derived PNG covers under the Tauri application-data `covers/` directory; the
source CBZ remains authoritative and covers can be regenerated. Shelf view uses
CSS perspective and keeps selection separate from opening a book.
Reader offers Fit Page, Fit Width, Fit Height and Original Size, bounded zoom
(25–400% of the chosen fit), reset and pointer-drag panning for oversized pages.
Direction/fit survive screen changes; zoom and pan reset on page changes.
These controls do not reload the current page. Preferences are not persisted.
V0.6 preloads nearby presentation groups in a memory-only, three-resource working
set with a 64 MiB decoded-size estimate target. Up to two active pages are pinned;
a large active pair may use up to 96,000,000 estimated bytes, with speculation skipped. Cached navigation avoids a new archive read.
Large pages reduce neighbor retention; leaving Reader clears the cache.
See [architecture](docs/architecture.md) for precise limits, ordering, supported
ZIP variants, cover storage, source/session contracts and resource ownership.

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

For manual native testing, Python 3's standard library creates ten synthetic archives:

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v06
```

No downloads or real manga are needed. Follow the native release scenario in
[validation](docs/validation.md). Automated test success does not establish native
picker, CSP or WebView rendering success.

## Linux Wayland / NVIDIA troubleshooting

On the tested Hyprland/NVIDIA GTX 1070 Ti machine (WebKitGTK 2.52.6), normal native
Wayland startup reproduces GDK Error 71. The following opt-in Linux-only launcher
was verified to render the application and CBZ pages as a native Wayland client:

```sh
bun run dev:wayland-compat
```

It sets only `__NV_DISABLE_EXPLICIT_SYNC=1`; it does not force X11 or disable the
WebKitGTK DMABUF renderer. This is an upstream graphics-stack compatibility
workaround, not a Reader requirement or a universal Linux setting. The helper
rejects non-Linux hosts. Use a clean environment without inherited X11/DMABUF
workarounds when testing it. Windows/macOS and unaffected Linux systems continue
to use `bun run dev`, which remains unchanged.

After graphics-stack updates, retest plain `bun run dev` with compatibility flags
unset. Production startup sets none of these flags. Consult the
[Tauri graphics guide](https://v2.tauri.app/develop/debug/linux-graphics/) and the
[local validation record](docs/validation.md#v061-linux-wayland--nvidia-development-compatibility)
for evidence and outstanding native acceptance. XWayland remains only a diagnostic
last resort, not the normal development backend.

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

V0.3/V0.4 add no dependencies. Archive validation and security limits are unchanged.

## V0.5 persistence

Rust owns `rusqlite` 0.40.2 with default features disabled and `bundled` enabled.
SQLite is compiled with the native build toolchain; no system SQLite installation,
frontend SQL plugin or ORM is required. Linux builds are verified; Windows/macOS
need their usual native C/C++ toolchains and remain untested. Bun dependencies are
unchanged. Cargo.lock includes SQLite and its required transitive dependencies.

The database is `library.sqlite3` under Tauri's application-data directory, normally
`${XDG_DATA_HOME:-~/.local/share}/dev.mangareader.desktop/` on Linux. It is neither
in the repository nor beside comics. The first open migrates schema version 0 to 1
transactionally. Paths remain native; React receives opaque IDs and safe metadata.

Duplicate identity is canonical native path plus source kind, without archive
hashing. Copies/hard links/moved files are not deduplicated by content. Import
validates/indexes using existing CBZ limits, without decoding every page. Removing
a card never deletes its source. Missing sources retain their metadata and can be
restored to the original path; Refresh rechecks availability.

Page turns queue bounded, coalesced progress writes. Switching/closing books and
normal window closure flush pending progress. A write failure is visible and can
prevent closure until retry succeeds; force-killing the app can lose unflushed
progress. Opening alone never marks completion; navigating onto the last page
does, and navigating back clears completion. Single-page books become completed after their image is successfully presented. Reader settings and image caches remain memory-only.

See the isolated-database V0.5 manual scenario in [validation](docs/validation.md).
Native visual acceptance remains outstanding. V0.7 should add bounded, regenerable
cover thumbnails after completing that acceptance; it has not been started.

## V0.6 presentation

Choose Single or Double in Reader. Double pairs canonical pages; Cover alone
isolates the first page. Wide scans (width/height ≥ 1.2) display alone. RTL reverses
visual placement, never source order or progress identity. Previous/Next moves by
presentation group, and Go to page accepts a 1-based page number. Fit/zoom/pan apply
to the entire spread with undistorted, vertically centered pages.

Dimensions are learned lazily from normal safe page loads. A pair waits for
classification before display; newly discovered wide pages can adjust grouping
around the requested page. Distant jumps do not scan earlier unseen pages, so
grouping may evolve as dimensions become known. A failed slot offers Retry while
its successful neighbor remains usable. No splitting or transitions are included.

Progress stores the lowest canonical page of a spread. The existing completion
column records whether its final page reaches the book's end; no database migration
is needed. Mode and cover preferences are session-only. V0.6 adds no dependencies.
