# V0.2 validation

Base inspected: `0d4eeca5776c9e0f4a13c9adcd1306bc7bb597ea`, repository
`Ayota-Daniel/libray-and-reader`. The working tree was clean before this work.
Existing configuration was preserved. The old V0.1 note about an absent Git
history described a prior sandbox and no longer describes this repository.

Linux tools: Bun 1.4.3, Rust/Cargo 1.99.1. No Windows/macOS validation occurred.

## Automated checks

| Command                                                                                   | Result                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `bun install --frozen-lockfile`                                                           | Passed, no lockfile changes needed                  |
| `bun run format:check`                                                                    | Passed (Prettier + rustfmt)                         |
| `bun run lint`                                                                            | Passed, warnings treated as errors                  |
| `bun test`                                                                                | 20 tests passed, 90 assertions                      |
| `bun run typecheck:tests`                                                                 | Passed, includes source and all tests               |
| `bun run build:web`                                                                       | Passed, strict TypeScript and Vite production build |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked`                                | 20 Rust tests passed                                |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | Passed                                              |
| `bun run build`                                                                           | Passed, Linux release executable produced           |
| `python3 tools/make-fixtures.py /tmp/manga-reader-v02`                                    | Six synthetic fixtures generated successfully       |

Rust tests use an independent small ZIP writer to exercise Stored/Deflate,
subfolders, JPEG/PNG, duplicate names, natural/case/zero/Unicode ordering, empty and
truncated archives, irrelevant entries, unsafe cross-platform paths, symlinks,
encryption flags, unsupported compression codes, declared and actual byte limits,
metadata/entry limits, dimensions/decoder limits, truncated PNG, APNG rejection,
CRC errors, local/central disagreement and out-of-range pages. Session tests cover
failed/cancelled replacements, old/closed IDs, shutdown, stale revisions,
admission without a queue, resource drops, and closure while a real worker thread
is paused inside a page read. The encryption fixture tests flags; it does not
implement a real cryptographic writer because all encryption is rejected before
page access.

Frontend tests exercise reducer boundaries including one page, open/cancel/
replace/failure/close, pending-open disposal, navigation between screens, stale
page success/error, A → B → A, editable-field shortcuts, StrictMode cleanup,
malformed DTOs and Library error distinctions. Protocol-adapter tests mock Tauri
and fetch to verify opaque URL construction, binary blobs, busy retry, structured
errors, cancellation, dimensions and object-URL disposal. **Those mocks do not
validate native WebView custom-protocol behavior or CSP.**

The generated Tauri ACL manifest was inspected: all seven application commands
have explicit permissions granted only to the main local window. No filesystem
or frontend dialog-plugin permissions were added. No existing dependency versions
were generally upgraded; the lockfile delta adds the required dependencies and
their transitive dependencies.

## Native checks: incomplete

The compiled release was launched with its normal environment. It exited with
GDK Wayland protocol error 71. The process-local XWayland fallback below remained
alive until a deliberate five-second timeout without diagnostics. **This is only
a startup check, not evidence of rendering, Library IPC, selection or page delivery.**

Native window observation/input and native dialog automation are unavailable to
this agent session (browser automation alone is insufficient). Therefore none of
the following is claimed as manually verified: native Library receiving `[]`,
CBZ selection, rendered pages, rapid native navigation, session retention,
replacement/close, or release media/CSP behavior. These are outstanding acceptance
checks. The final build must be exercised in a graphical Linux session before
V0.2 is considered fully validated.

## Reproducible native acceptance scenario

Generate the fixtures and launch **the release executable**, not Vite:

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v02
bun run build
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 src-tauri/target/release/manga-reader
```

The environment overrides are process-local. Do not change system settings.
Use `bun run dev` separately to compare development behavior if a release-only
problem occurs; the release scenario is required for CSP/transport acceptance.

1. Open Library. Confirm **Desktop core connected · 0 books**, rather than an
   unavailable-runtime error. This specifically verifies real native IPC and ACL.
2. Open Reader → **Open CBZ**. Confirm a native picker restricted to one CBZ.
   Select `/tmp/manga-reader-v02/ordered.cbz`.
3. Confirm title `ordered`, counter `1 / 3`, and a blue page with numeral **1**.
   This verifies the custom media protocol, CORS headers, CSP, blob and native
   image decoder together in release.
4. Use Next and Right Arrow, including with a navigation button focused. Confirm
   the green **2**, then red **10**, in that order. Check the counter, image aspect
   ratio, disabled endpoint buttons and absence of wraparound. Enter/Space on a
   button must produce exactly one action.
5. Alternate arrows rapidly. Confirm the final image agrees with the final counter,
   loading never labels an old page as the new one, and no stale error replaces it.
6. Stop on page 2. Visit Home, Library and Settings, then Reader. Confirm the title
   and `2 / 3` remain, and arrows outside Reader did not change the position.
7. Open the picker and cancel. Confirm the same title/page remain.
8. Try replacing with `invalid.cbz`, `empty.cbz` and `unsafe.cbz`. Confirm meaningful
   errors and continued navigation in the previous book after each failure.
9. Replace with `single.cbz`. Confirm `1 / 1`, the first page and both endpoint
   buttons disabled. No previous-session image should flash into the new session.
10. Replace with `corrupt-middle.cbz`. Page 1 works; page 2 shows a page error but
    stays `2 / 3`; page 3 remains readable as the red **10**.
11. Close the book while navigating/loading. Confirm the empty state and no delayed
    image/error. Reopen `ordered.cbz`; confirm page 1. Library must still be empty.
12. Exit and restart. Confirm no book/session is restored. Repeat on native Wayland
    only when the host display issue can be investigated separately.

Record the actual observations, platform and display backend when this scenario
is completed. If rendering or CSP fails, retain terminal diagnostics; do not
replace this scenario with a process-alive check or browser mocks.

## Remaining limitations

- Native end-to-end acceptance is outstanding; Wayland remains unresolved.
- Windows/macOS and installers are untested; no validation is implied by URL mocks.
- ZIP64/split/SFX archives, legacy non-UTF-8 filenames, animated PNG, WebP and
  other formats are deliberately unsupported; see the exact limits in architecture.
- In-place modification of an open archive and unresponsive storage can produce
  errors/delayed cancellation. Codec/OS calls already running cannot be forcibly
  cancelled, but byte/pixel/concurrency budgets remain enforced.
- Payload budgets do not guarantee a hard process/GPU RSS ceiling in WebKit.

Next milestone: first complete native release acceptance on Linux; then a small
reader-preferences milestone (LTR/RTL mapping and explicit fit mode), without
mixing in persistence, remote sources or animation.
