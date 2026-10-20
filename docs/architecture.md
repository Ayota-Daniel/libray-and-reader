# V0.1 architecture

This is a local-first desktop application: one React application and one Rust
crate hosted by Tauri 2. Vite is a development tool; there is no production web
server. No database, providers, or archive parsers exist yet.

## Ownership and dependency direction

React owns the shell, screen selection, view state, input mapping, and rendering.
`app` composes `screens`; screens compose feature hooks and renderers. `shared/ui`
contains only genuinely shared presentation. Feature models are independent of
React and Tauri. No router or global state library is needed for four screens.
Screen state currently resets on navigation; persisted reading sessions are future work.

Rust owns content access, archive parsing, image processing, cache policy, and
persistent metadata when those are introduced. `core` must not import Tauri.
`commands.rs` is the IPC adapter: validate input, call core operations, and convert
results into serialized DTOs. Keep this as one crate until an actual reuse or
compilation need warrants splitting it.

The first vertical slice is `LibraryScreen → useLibrary → shared/ipc/library →
list_books → core::library`. The core returns an empty catalog, not demonstration
books. The frontend validates the response shape and displays loading, empty,
and failure states. DTOs are intentionally small and handwritten for now.

Use request/response commands for bounded operations; use events/channels only
when real progress streams exist. Future blocking archive/image work must run off
the UI thread and support cancellation. Return structured errors at that point.
Do not send full books or base64 page arrays over JSON IPC. Large media should use
scoped asset/custom-protocol URLs backed by Rust-managed handles. Validate paths
and source identifiers in Rust; a frontend type is not an authorization boundary.

The only application command is the read-only catalog query. Tauri application
commands registered with `invoke_handler` are available by default; the empty
capability grants no plugin/core privileges. Only the local main window is
configured, with a production CSP and no remote pages. Future file access must
be explicitly scoped and validated, without exposing arbitrary filesystem access.

## Reader

`state.ts` owns a pure reducer with bounded logical page navigation. `useReader`
connects it to React. `ReaderNavigation` owns controls and `ReaderViewport` owns
the rendering surface. V0.1 displays an empty viewport and disabled controls.
There is no fabricated reading session or image loading implementation.

Future reader sessions receive opaque book/page identifiers, page count, and
lightweight dimensions from the source layer. The reader never branches on CBZ,
CBR, PDF, HTTP, or vendor names. Reading order (LTR/RTL), layout (single, spread,
continuous), fit/zoom, and physical key/gesture mapping are separate concerns.
Logical next means next in reading order, regardless of its screen direction.

Only request the active visible pages and a bounded neighborhood. Rust owns a
byte-budgeted cache; the renderer releases offscreen decoded resources. Cancellation
and request generations must prevent stale pages from replacing the current one.
Full-resolution images must never all live in React state at once.

## SourceProvider (planned contract)

A provider opens a source into an opaque session, supplies ordered page metadata,
and resolves one page on demand; it also closes/cancels sessions. Rust owns provider
selection and source-specific credentials or transport. Local archives/folders,
PDF, SMB/WebDAV, OPDS, Komga/Kavita, HTTP adapters, and eventually plugins can fit
behind this boundary. Define the concrete Rust trait when the first provider
exists; async behavior, seek capabilities, and error handling need evidence from
that implementation. Do not promise a plugin ABI yet.

## PageTransition (planned contract)

A transition engine sits inside the viewport, separate from navigation and page
acquisition. Its eventual inputs include outgoing/incoming page resources,
viewport geometry, logical direction, LTR/RTL, and effective motion preference.
It owns prepare/start/cancel/dispose lifecycle and completion notification. Its
host surface may use DOM, CSS 3D, Canvas, or WebGL; the reader must not require CSS
class names or DOM page children as the universal interface. None is the baseline;
Slide, Fade, Reveal, and PageCurl are future engines. Navigation commits without
waiting on animation; cancellation and reduced motion must always work.

There is no speculative transition interface in V0.1. The shell respects system
reduced motion, has no animated navigation, and leaves an explicit override for
future settings work.

## Library and remaining domains

Home is a future activity dashboard (continue/recently opened/recently added).
Library is the whole catalog. `useLibrary` owns loading state; `LibraryGrid`
receives metadata through props. Future List and ImmersiveShelf renderers consume
the same catalog/selection state. Covers, spines, thickness, and shelf animations
belong to renderers, not the catalog or source provider.

The following are ownership boundaries, not empty modules created in anticipation:

| Domain                        | Future owner                                    | React consumes                                     |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Sources and page/media models | Rust `core::sources`, `core::media`             | Opaque sessions and page descriptors               |
| Image processing              | Rust `core::image_processing`                   | Options and processed media handles                |
| Cache                         | Rust `core::cache`                              | Resource availability, never eviction mechanics    |
| Reading progress              | Rust `core::progress`                           | Session position, bookmarks, dashboard summaries   |
| Settings                      | Rust persistence with frontend preference state | Validated preferences and effective motion setting |
| Library                       | Rust `core::library`                            | Renderer-independent book metadata                 |
| Reader                        | Frontend `features/reader`                      | Source-independent page data                       |

SQLite can be chosen when persistence requirements justify it. Sources and caches
must remain independent of library presentation. Cross-platform path handling
belongs to Rust (`Path`/`PathBuf`); avoid shell commands in application runtime.

## Scope and next milestone

V0.1 implements the build foundation, four-screen shell, real empty-catalog IPC,
reader separation, and navigation-bound tests. It intentionally postpones actual
imports, image display, formats, remote sources, persistence, enhancements,
bookmarks, cache/preloading, rich transitions, bookshelf visuals, and installers.

V0.2 should implement one end-to-end local CBZ flow: a scoped native file picker,
Rust archive validation and ordered image metadata, lazy single-page delivery,
a single-page viewport with previous/next keyboard and button navigation, and
bounded resource cleanup. Test malformed archives, traversal entries, decompression
limits, ordering, and navigation bounds. Keep remote sources, persistence, and
animations out of that milestone.
