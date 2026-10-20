# Manga Reader

V0.1 foundation for a local-first Linux desktop comic/scan/manga reader, built with
Tauri 2, React, strict TypeScript, Vite, Bun, and Rust. Windows and macOS remain
architectural targets; builds must be validated on each native platform.

The application contains Home, Library, Reader, and Settings placeholder screens.
Library makes a real Rust IPC call and returns an empty catalog. Importing and
reading files are not implemented yet.

## Linux prerequisites

Install Bun, a stable Rust toolchain (including rustfmt and Clippy), and the
[Tauri 2 native prerequisites](https://v2.tauri.app/start/prerequisites/).
On Arch Linux:

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf
```

On Debian/Ubuntu:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev
```

Use a graphical desktop session to run the application. Bun drives development
and builds; it is not bundled as an application runtime. Commit both lockfiles.
TypeScript is pinned to the 5.9 stable line supported by the current ESLint tooling.

## Install, develop, and build

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

The development command starts Vite and the native Tauri application. For a
browser-only shell preview use `bun run dev:web`; library IPC deliberately reports
an error there because no desktop core is present.

Build the frontend and release desktop executable:

```sh
bun run build
```

On Linux the executable is `src-tauri/target/release/manga-reader`. This builds
without installer bundles. Installer assets, signing, and distribution identity
(the current development identifier is `dev.mangareader.desktop`) are postponed.
No production backend web server is required.

## Checks

```sh
bun run format:check
bun run lint
bun test
bun run build:web
bun run check:rust
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run build
```

Use `bun run format` to apply formatting. See [architecture](docs/architecture.md)
for ownership boundaries and the precise next milestone.

## Direct dependencies

Runtime frontend dependencies:

- `react`, `react-dom`: UI rendering and local feature state.
- `@tauri-apps/api` (2): typed access to Tauri IPC, isolated in `shared/ipc`.

Development dependencies:

- `typescript`: strict compile-time checks.
- `@types/react`, `@types/react-dom`: React TypeScript declarations.
- `vite`, `@vitejs/plugin-react`: frontend development/build pipeline and React refresh.
- `@tauri-apps/cli` (2): native development and build orchestration.
- `eslint`, `@eslint/js`, `typescript-eslint`: JavaScript/TypeScript linting.
- `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`: hook and refresh correctness.
- `globals`: browser global definitions for linting.
- `prettier`: consistent frontend/configuration/documentation formatting.

Rust dependencies:

- `tauri` (2): native window, WebView, and IPC runtime.
- `serde` with derive: serialization of the small IPC DTO.
- `tauri-build` (2, build dependency): Tauri configuration/build integration.

Bun supplies the test runner. No router, global store, database, CSS framework,
filesystem plugin, archive library, or speculative provider dependencies are added.

## Display troubleshooting on the current Linux machine

The default Wayland startup check exited with a GTK protocol error. XWayland alone
reported GBM allocation errors. This process-local fallback stayed running for an
eight-second smoke check without diagnostics:

```sh
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run dev
```

The same environment variables can prefix the release executable. They are not
hardcoded into the app and do not change system configuration. Native visual/IPC
interaction still needs manual verification; browser navigation was checked.
