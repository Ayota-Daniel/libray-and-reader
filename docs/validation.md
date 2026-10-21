# V0.6 validation

Historical V0.5 base inspected: clean local `4b74c5c` (V0.3 && V0.4), following `7f9ce19`
(V0.2), repository `Ayota-Daniel/libray-and-reader`. Existing implementation and
validation procedures were retained.
Existing configuration was preserved. The old V0.1 note about an absent Git
history described a prior sandbox and no longer describes this repository.

Linux tools: Bun 1.4.3, Rust/Cargo 1.99.1. No Windows/macOS validation occurred.

## Automated checks

V0.6 final run: 2026-10-21. Base: clean committed V0.5 `7e7b781`. All checks below passed. The release build includes
the strict application TypeScript/Vite build. Rust tests and Clippy also succeeded
with `--locked --offline`; the Linux release executable was rebuilt for V0.6.

| Command                                                                                   | Result                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `bun install --frozen-lockfile`                                                           | Passed, no lockfile changes needed                  |
| `bun run format:check`                                                                    | Passed (Prettier + rustfmt)                         |
| `bun run lint`                                                                            | Passed, warnings treated as errors                  |
| `bun test`                                                                                | 69 tests passed, 441 assertions                     |
| `bun run typecheck:tests`                                                                 | Passed, includes source and all tests               |
| `bun run build:web`                                                                       | Passed, strict TypeScript and Vite production build |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked`                                | 32 Rust tests passed                                |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | Passed                                              |
| `bun run build`                                                                           | Passed, Linux release executable produced           |
| `python3 tools/make-fixtures.py /tmp/manga-reader-v06`                                    | Ten synthetic fixtures generated successfully       |

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

The generated Tauri ACL manifest was inspected: all twelve application commands
have explicit permissions granted only to the main local window. No filesystem
or frontend dialog-plugin permissions were added. V0.5 adds event listen/unlisten
and window destroy for the close-flush handshake, and bundled rusqlite on Rust.
Bun dependencies and lockfile are unchanged. The release command now accepts an individual ticket ID; security scopes and
archive limits remain unchanged.

V0.3 adds seven frontend tests covering fit formulas (portrait/landscape), invalid
geometry, bounded deterministic zoom, reset, pan clamping, LTR/RTL and unchanged
logical operations. React interaction tests exercise all fit controls, resize,
manual zoom/reset/limits, pointer capture/cancellation, geometry and page resets,
editable controls and direction/fit retention. They assert the same image element,
one acquisition, no abort and no resource release throughout viewport settings
changes. Resize measurements and pointer capture are simulated in Happy DOM;
these tests do not establish actual browser layout or native visual correctness.
Existing stale-resource tests remain, with A → B → A now expecting retained-resource
reuse. V0.4 native lease changes add two Rust tests and adapt the old revision test.

## Native checks: incomplete

During V0.2, the compiled release was launched with its normal environment. It exited with
GDK Wayland protocol error 71. The process-local XWayland fallback below remained
alive until a deliberate five-second timeout without diagnostics. **This is only
a startup check, not evidence of rendering, Library IPC, selection or page delivery.**

Native window observation/input and native dialog automation are unavailable to
this agent session (browser automation alone is insufficient). Therefore none of
the following is claimed as manually verified: native persistent Library IPC,
CBZ selection, rendered pages, rapid native navigation, session retention,
replacement/close, or release media/CSP behavior. These are outstanding acceptance
checks. The final build must be exercised in a graphical Linux session before
V0.2–V0.5 are considered fully validated. No native visual acceptance was performed
for V0.4 or V0.5; the prior startup observation is not a new Reader acceptance result.

## Reproducible native acceptance scenario

Generate the fixtures and launch **the release executable**, not Vite:

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v04
bun run build
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 src-tauri/target/release/manga-reader
```

The environment overrides are process-local. Do not change system settings.
Use `bun run dev` separately to compare development behavior if a release-only
problem occurs; the release scenario is required for CSP/transport acceptance.

1. With an isolated empty database, open Library. Confirm an empty library and
   enabled Add Books, rather than an unavailable-runtime error. This verifies IPC/ACL.
2. Open Reader → **Open CBZ**. Confirm a native picker restricted to one CBZ.
   Select `/tmp/manga-reader-v04/ordered.cbz`.
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

## V0.3 additional native acceptance (not yet performed)

Keep and complete all twelve V0.2 checks above, starting with LTR and Fit Page.
Then open `viewport.cbz`, which contains a 1600×2400 portrait and a 2400×1600
landscape page. Unlike the tiny fixtures, these exceed a typical viewport at 100%.

1. With the portrait page, select Fit Page: the entire image should be visible
   with its aspect ratio preserved. Select Fit Width: fill the available width
   and scroll/drag down to see the lower edge when needed. Select Fit Height:
   fill the height. Select Original Size: the 1600×2400 image must overflow a
   smaller viewport, with both scroll axes available. Repeat on the landscape
   page to exercise horizontal overflow with Fit Height.
2. Resize the window in all four modes. Fit should follow available viewport
   dimensions; Original Size remains intrinsic. Check edges remain reachable,
   no distortion, scrollbar oscillation, permanently blank area or loading flash.
3. Zoom in/out to both limits (400% and 25% of fit); endpoint buttons disable.
   Reset returns to the selected fit, not necessarily intrinsic 100%. Change
   fit during manual zoom: zoom resets. Resize during manual zoom: multiplier stays.
4. Drag an oversized page with the primary pointer, including past its edges and
   outside the viewport before releasing. Check bounded offsets and no page turn.
   Cancel/release the pointer and confirm movement stops. Resize while dragging;
   no stale drag should resume. Scrollbars must also reach every edge. Reset zoom
   while already at fit clears pan; fit/page changes reset it. Toolbar clicks
   and navigation buttons must not start dragging.
5. In LTR, right advances and left goes back. In RTL, left advances and right goes
   back; Next stays logically next and appears to the left of Previous. Page
   order stays portrait then landscape. Test both endpoints, single-page book,
   button focus, rapid arrows and arrows while a direction/fit select is focused.
6. Change fit/zoom/pan/direction repeatedly on a loaded page. Observe no loading
   placeholder or image reload. If native developer tooling is available, confirm
   no additional page command/media request until navigation. Automated API-spy
   tests cover this boundary but do not replace native observations.
7. After manual zoom/pan, navigate: the next page starts at its chosen fit and
   top/left origin. Switch screens: direction/fit and page remain, zoom/pan reset;
   returning legitimately reacquires the page under V0.2's resource policy.
   Restart: defaults are LTR and Fit Page, with no restored session.

Wayland's GDK protocol error is a separate host/display issue. Record the actual
backend when testing Reader behavior; do not equate a startup failure with a
fit/navigation defect, or a surviving process with successful visual acceptance.

## Remaining limitations

- Native end-to-end acceptance is outstanding; Wayland remains unresolved.
- Windows/macOS and installers are untested; no validation is implied by URL mocks.
- ZIP64/split/SFX archives, legacy non-UTF-8 filenames, animated PNG, WebP and
  other formats are deliberately unsupported; see the exact limits in architecture.
- In-place modification of an open archive and unresponsive storage can produce
  errors/delayed cancellation. Codec/OS calls already running cannot be forcibly
  cancelled, but byte/pixel/concurrency budgets remain enforced.
- Payload budgets do not guarantee a hard process/GPU RSS ceiling in WebKit.

Recommended V0.6: complete native acceptance first, then bounded, regenerable
cover thumbnails with separate derived storage and opaque delivery. V0.6 has not
been started.

## V0.3 changed files

- New Reader modules: `src/features/reader/layout.ts`, `useViewport.ts`,
  `ReaderControls.tsx`, `ReaderPresentation.tsx`.
- Updated Reader modules: `src/features/reader/keyboard.ts`, `useReader.ts`,
  `ReaderNavigation.tsx`, `ReaderViewport.tsx`; composition in
  `src/screens/ReaderScreen.tsx`; styling/version in `src/app/styles.css` and
  `src/app/App.tsx`.
- New tests/helpers: `tests/layout.test.ts`, `tests/viewport-observer.ts`;
  updated `tests/reader-ui.test.tsx`, `tests/setup.ts` and
  `tools/make-fixtures.py` (large portrait/landscape fixture).
- Version only: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/tauri.conf.json`. No Rust source, permission or CSP change.
- Documentation: `README.md`, `docs/architecture.md`, `docs/validation.md`.

## V0.4 automated coverage

Nine deterministic cache tests cover current/adjacent acquisition order, retained
A → B → A, evolution after navigation, forward/backward rapid selection, foreground
promotion/preemption, count/memory limits, active protection, long traversal,
eviction disposal, local preload errors and foreground retry, screen detach,
StrictMode lease replay, close/replacement/cancel/failure and old-session completion.
Tests use deferred promises and explicit promise checkpoints, not timing sleeps.
Two new React tests verify LTR/RTL produce the same canonical acquisitions. Existing
fit/zoom/pan/resize tests now expect the initial neighbor preload and assert that
controls add no acquisitions or releases; StrictMode asserts no duplicate loads.

Three additional adapter tests prove successful delivery releases the exact native
ticket before URL disposal, abort-before-ticket handles late replies, and abort
while fetching releases once. Existing failure tests still run. Two additional Rust
tests prove the three-ticket bound, independent valid ticket reads, teardown of all
leases and foreground admission after cooperatively cancelling a gated preload.
The adapted revision test explicitly proves stale cleanup cannot cancel another
live ticket. Original controlled close-during-read and archive safety tests remain.

## V0.4 additional native acceptance (not performed)

Complete the V0.2 and V0.3 scenarios above first, then use `cache.cbz` (eight numbered
pages). Launch the release executable with the documented process-local display
fallback only if necessary. No new native visual observation is claimed.

1. Open the eight-page fixture, allow the first page/neighbor to finish, then go
   Next, Previous, Next. Check correct numerals/counters and no archive-loading
   delay on retained neighbors. A WebView decode/onLoad flash remains possible.
   If developer tooling is available, verify cached destinations cause no new
   `request_page` or media GET; a new outer neighbor may legitimately be requested.
2. Traverse forward and backward, reverse repeatedly, and rapidly select
   1 → 2 → 3 → 4 → 3 → 2. The final visible numeral must be 2 with no stale error.
   Revisit a page outside the three-page neighborhood: reacquisition is expected.
3. Verify both endpoints and `single.cbz`, including RTL. Direction changes do not
   change canonical preload indices. Previous/Next buttons retain logical meaning.
4. Change fit/zoom, pan and resize while neighbors finish. No current-page reload;
   navigation still resets transforms. Use `viewport.cbz` to exercise large pages.
5. Leave Reader and return. Session/index and fit/direction survive; resources are
   released offscreen and reacquired on return. Close during loading/preloading,
   reopen and verify no delayed old image or error.
6. Replace A with another book while work is pending. No A image appears in B.
   Cancel a picker, then try `invalid.cbz` and `unsafe.cbz`: A's cached pages remain
   navigable. Closing/restarting restores no book or cache.
7. Open `corrupt-middle.cbz` and wait on page 1. A failed page-2 preload must not
   disturb page 1. Navigate to page 2: its foreground retry may show the page error;
   page 3 remains readable. Returning to the cached page 1 must still work.
8. For a representative large local CBZ within existing limits, observe bounded
   retention while traversing many pages. Process RSS alone cannot prove cache
   ownership bounds (WebKit/allocator retention differs); use the automated ownership
   tests alongside observed behavior. No production cache-control UI was added.

Record platform/backend and actual observations. The previous Wayland/GDK startup
issue is separate from Reader cache correctness; a surviving process is not native
acceptance.

## V0.4 file inventory (in addition to the preserved V0.3 list above)

- Added: `src/features/reader/pageCache.ts`, `tests/page-cache.test.ts`.
- Resource ownership: `src/features/reader/controller.ts`, `model.ts`, `usePage.ts`;
  `src/shared/ipc/reader.ts`.
- Native contract: `src-tauri/src/core/reader.rs`, `core/reader/tests.rs`,
  `src-tauri/src/commands.rs`. Media authorization, CSP and capabilities unchanged.
- Tests/helpers: `tests/reader-ui.test.tsx`, `tests/reader-fixtures.ts`,
  `tests/ipc.test.ts`, `tools/make-fixtures.py`.
- Version/documentation: `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `src/app/App.tsx`,
  `README.md`, `docs/architecture.md`, `docs/validation.md`.

## V0.5 automated coverage

Nine additional Rust tests use isolated temporary databases/archives: migration and
reopen/idempotency/future-version/corruption handling, valid/invalid/duplicate import,
stable IDs and path-free DTOs, missing/restore/remove semantics, saved progress and
resume/clamping/completion, valid Reader page access, structured write failures and
retry, bounded operation admission, malformed records, latest coalesced shutdown
flush, and preservation of the prior Reader on metadata-write failure/cancellation.
No test accesses the developer's real application database.

Nine additional frontend tests cover empty/populated/import results, resume,
completion/backward navigation, refresh, Continue Reading, missing/removal wording,
temporary opening, database errors and DTO validation; controlled deferred promises
verify coalescing, flush and retry/close behavior. Existing Reader/cache tests pass.
The controller tests now use explicit open-entry gates instead of a fixed microtask
count. Happy DOM and mocks do not establish native close-dialog behavior.

## V0.5 native acceptance (not performed)

Use a fresh isolated test-data directory and synthetic sources. Reuse the same
XDG_DATA_HOME for every restart in this scenario; choose a new directory for a new
empty-library run. These environment variables affect this process only.

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v05
XDG_DATA_HOME=/tmp/manga-reader-v05-data GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 src-tauri/target/release/manga-reader
```

1. Start with that fresh test-data directory; Library is empty without DB errors.
2. Add Books: select `ordered.cbz` in the native picker.
3. Confirm its real title, three-page count and unread card.
4. Import the same file again.
5. Confirm one duplicate result and still one card.
6. Multi-select `cache.cbz`, `viewport.cbz`, `single.cbz` and `invalid.cbz`; verify
   per-file results, valid entries only and no paths in error messages.
7. Open ordered from Library; verify the existing Reader displays page 1.
8. Navigate to page 2; close immediately after a turn to exercise flush.
9. Close the application using its normal window close action.
10. Restart with the same test-data directory.
11. Confirm the same library entries remain.
12. Reopen ordered from Library.
13. Confirm page 2 (index 1), correct image and working navigation/cache/controls.
14. Navigate to the final page.
15. Return to Library: confirm completed; reopen and move back, then verify reading.
16. Remove viewport with Remove from Library.
17. Confirm `/tmp/manga-reader-v05/viewport.cbz` still exists and can open temporarily.
18. Close the Reader and externally rename the synthetic ordered source temporarily.
19. Restart with the same test-data directory.
20. Confirm unavailable card; opening gives a recoverable error and keeps metadata.
21. Restore the original filename; Refresh and open successfully at saved progress.
22. Navigate, visit Home and use Continue Reading; verify the same saved-page flow.

Also confirm Open CBZ never adds a card or saves temporary progress; cancellation
and failed replacements preserve the prior Reader. Test close during rapid turns,
and verify progress after restart. Verify opening single.cbz alone does not mark
it completed. To exercise changed archive counts, use only copies of synthetic
fixtures and replace a closed three-page source with a one-page fixture at the
same path; reopening must clamp to page 1. Record observed backend/platform/results.

Retain all V0.2–V0.4 scenarios above: their Open CBZ operations are temporary, so
claims about no restored session and no Library additions still apply. The known
Wayland protocol error is a separate host issue. No V0.5 native window, picker,
restart/resume or visual acceptance is claimed by the automated suite/release build.

## V0.5 changed files

- Native service/storage: `src-tauri/src/core/library.rs`, new
  `core/library/{repository,progress,tests}.rs`; `core/error.rs`, `core/reader.rs`.
- Native adapters/setup: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/build.rs`,
  `capabilities/main.json`, five generated permission files for add/remove/open
  library book/record progress/flush progress.
- Frontend: `src/app/{App.tsx,styles.css}`, Library model/grid/hook,
  `src/screens/{HomeScreen,LibraryScreen}.tsx`, `src/shared/ipc/{library,reader}.ts`,
  Reader model/controller and new `src/features/reader/progress.ts`.
- Tests: new `tests/library.test.tsx`, `tests/progress.test.ts`; updated
  `tests/controller.test.ts`.
- Version/dependencies: `package.json`, `src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json}`.
- Documentation: `README.md`, `docs/architecture.md`, `docs/validation.md`.

Limits: canonical-path identity only; no relink/watch/search/series, placeholder
covers, one-page completion remains reading, no persisted display preferences,
and abrupt termination may lose unflushed progress. Native visual acceptance and
Windows/macOS testing remain outstanding.

## V0.6 — Spread Reader & Direct Page Navigation

Base inspected: clean committed V0.5 `7e7b781`. Git history, migrations, Reader,
PageCache, architecture and prior validation were inspected before implementation.
No baseline commit was necessary. The V0.6 working changes are not committed or
pushed. No runtime dependency, CSP permission, archive limit or SQLite migration
was added. Only the application version changes in Cargo.lock; user_version is 1.

### Automated coverage

The original 50 frontend tests remain. New deterministic tests cover Single/Double,
even/odd counts, cover isolation, wide pages at all positions and consecutive wide
pages, ratio threshold, LTR/RTL placement, containment across mode switches,
resume, whole-number input validation, group navigation, canonical completion and
backward progress, one-page image-load completion, lazy regrouping around requested
pages, active-set pinning, count/memory bounds, overload without speculation,
foreground retry, reverse retained-resource reuse, partial failures, stale slots,
replacement/close and screen detach. React tests cover controls and form submission,
keyboard exclusion while typing, composed geometry/fit/zoom/resize and resource
reuse. Existing pan and stale-resource tests remain. Happy DOM simulates geometry;
it does not prove native visual correctness or physical pointer behavior.

A new Rust test verifies canonical anchor plus two-page completion, rejects invalid
spans, checks backward progress and confirms schema version remains 1. Existing
SQLite, archive, cancellation, resource and migration tests remain. No test uses
the developer's actual Library database. Generated spread fixtures are synthetic.

### V0.6 native manual acceptance — not performed

Generate ten fixtures (the prior eight plus `spread-odd.cbz` and `spread-wide.cbz`).
Use a fresh directory for an empty test library, keeping the same data directory
for restarts. Run the release binary, not the browser-only preview:

```sh
python3 tools/make-fixtures.py /tmp/manga-reader-v06
XDG_DATA_HOME=/tmp/manga-reader-v06-data GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 src-tauri/target/release/manga-reader
```

1. Repeat V0.2–V0.5 native scenarios above. In Single, verify normal Previous/Next,
   first/last bounds, cancellation, missing source and temporary Open CBZ semantics.
   V0.5's old one-page limitation is superseded: successful image presentation now
   completes a one-page Library book; importing it alone does not.
2. Temporarily open `cache.cbz` (eight portrait pages). Choose Double, Cover alone
   off: verify `1–2`, `3–4`, `5–6`, `7–8`, correct numerals and endpoint buttons.
3. Open `spread-odd.cbz` (seven portraits): final page 7 stands alone. Toggle Cover
   alone on/off in both books: page 1 isolates when enabled, with correct odd tail.
4. Open `spread-wide.cbz`: pages 1, 4, 5 and 8 are wide; each must display alone.
   The resolved sequence without cover is `[1],[2,3],[4],[5],[6,7],[8]`. Page 3 has
   a different height. Verify no stretching and vertical centering of paired pages.
5. In LTR, page 2 is left and 3 right; in RTL they swap. Next/Previous keeps canonical
   order; right advances in LTR, left advances in RTL. Indicator remains `2–3`.
6. Jump to first, middle and final pages in both modes. A jump to either member of
   a pair selects that group. Try blank, text, 0, negative, fraction and beyond-end:
   an accessible error appears without moving. Arrow keys in the input never turn.
7. Switch Single → Double while on the second page of a candidate pair; the group
   must contain it. Double → Single selects the lower canonical index. Toggle cover
   during reading. No source reopen/picker should occur; transforms reset.
8. On `viewport.cbz` and portrait pairs, test all four fit modes, zoom limits/reset,
   scroll/pointer pan and window resize. The spread uses one common scale, preserves
   both aspect ratios and remains reachable at its edges. No image reacquisition
   should occur from settings alone; use dev tooling if available.
9. Navigate forward/back and rapidly through several groups. Confirm the latest
   indicator/images match; a late old slot never joins the current group. Preloaded
   pages should avoid an archive read, though WebView image decode can still load.
10. Use `corrupt-middle.cbz` in Double: retain the valid slot and show a contained
    error plus Retry for the corrupt page. Retry must not discard the good resource.
    Navigate past it; failed speculation must not overwrite active-page state.
11. Add a valid book to Library, read in Double, close normally immediately after
    a turn and restart with the same data directory. Mode defaults to Single;
    reopening resumes the lowest canonical index of the prior spread. Switching
    back to Double includes that page. Reaching the final group completes it;
    navigating back restores Reading. Confirm a valid one-page book completes only
    once its image has actually appeared.
12. Close/replace during loading, cancel or fail replacement, visit other screens
    and return, and remove/restore a synthetic source externally. Check cleanup,
    preserved session on failure and recoverable missing-file behavior as before.
13. With two large portrait pages within the native limits, verify both remain
    readable while speculative retention decreases. Automated ownership tests prove
    resource bounds; process RSS alone is not evidence of those bounds.

Record actual platform/backend, observations and diagnostics. Native observation
and dialog control are unavailable in this agent session. No native visual/manual
acceptance is claimed. The earlier Wayland/GDK protocol error remains a separate
host issue; the process-local fallback does not establish rendering correctness.

### V0.6 changed files and limits

- New planner: `src/features/reader/presentation.ts`; tests:
  `tests/presentation.test.ts`.
- Reader state/cache/UI: `controller.ts`, `pageCache.ts`, `usePage.ts`, `model.ts`,
  `progress.ts`, `ReaderPresentation.tsx`, `ReaderViewport.tsx`,
  `ReaderNavigation.tsx`, `src/screens/ReaderScreen.tsx`, `src/shared/ipc/reader.ts`,
  `src/app/styles.css`. Existing fit/input/source abstractions are retained.
- Native progress span: `src-tauri/src/commands.rs`, `core/reader.rs`,
  `core/library.rs`, `core/library/repository.rs`, `core/library/tests.rs`.
- Tests/fixtures: `tests/reader-ui.test.tsx`, `tests/page-cache.test.ts`,
  `tools/make-fixtures.py`.
- Versions/docs: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/tauri.conf.json`, `src/app/App.tsx`, README and architecture/validation.

Limits: orientation is an aspect-ratio heuristic discovered lazily, not a complete
upfront book map. Pairing can change as earlier wide pages are discovered. No split,
continuous mode, transitions, covers, preference persistence or disk image cache.
Three resource slots and normal 64 MiB estimated budget remain; two active pages
may use up to 96,000,000 estimated bytes, with speculation skipped, and acquisition
peak stays below 110 MiB. These are not WebView RSS guarantees. Native Linux visual
acceptance and Windows/macOS testing remain outstanding.

Exact recommended V0.7: complete native acceptance, then bounded, regenerable
Library cover thumbnails, stored outside SQLite/source archives and served through
opaque identifiers. No V0.7 work has been started.
