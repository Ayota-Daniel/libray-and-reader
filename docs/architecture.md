# V0.6 architecture

One React application, one Rust crate, Tauri 2. Rust-owned SQLite persists Library
metadata and logical reading progress. Reader sessions, page tickets, image caches
and display preferences remain transient. V0.6 adds Single/Double presentation
groups and direct page navigation; its detailed section below supersedes the
historical single-page presentation/cache descriptions. Open CBZ is temporary; Add Books is a
persistent import. Both opening routes use the same Reader and PageCache.

## Ownership

- `app/App.tsx` owns the `useReader` controller above the screens. Moving between
  screens preserves the current session and page index.
- `features/reader/controller.ts` owns open/replace/close state and logical
  navigation. It contains no archive, path, or WebView transport implementation.
- `controller.pages` owns a `PageCache`; `usePage` subscribes to it and activates
  it while Reader is mounted. The cache owns abort controllers and page resources.
  `ReaderViewport` renders it; `ReaderNavigation` renders controls. Keyboard mapping
  is separate from logical previous/next and supports LTR/RTL.
- Screens compose these pieces without invoking Tauri directly.
- `shared/ipc` owns commands, DTO validation, structured error translation,
  `convertFileSrc`, fetch and object-URL lifetime. No filesystem path crosses IPC.
- Rust `core::reader` owns sessions, replacement transactions, opaque IDs,
  cancellation and read admission. `core::sources::PageSource` supplies the minimal
  real source boundary: metadata count and on-demand page access. `CbzSource::open`
  creates it; dropping it closes the source. No provider registry is needed.
- `core::sources::cbz` owns ZIP validation, deterministic ordering and page decode
  validation. `core` imports no Tauri types. Commands and `media.rs` only authorize,
  schedule bounded work and convert the results to DTOs or HTTP-shaped responses.

Library consumes safe persistent catalog metadata. Home selects the most recently
read book, falling back to last opened time, with an ID tie-breaker. Both use the
same BookCard and library-opening callback; no fabricated activity is displayed.

## Session and page contract

`begin_open` reserves one opaque operation ID. `open_selected(operationId)` claims
it once, launches a single-file native CBZ picker, then validates/indexes on a
blocking worker. The path stays native. Cancellation returns `null` and leaves the
current session untouched. Errors also preserve it. `cancel_open` invalidates the
reservation, including work already running. A cancelled modal picker must still
be dismissed; its job retains the single opening slot until it finishes.

A successful open atomically replaces the native session and returns:

```ts
{
  sessionId: string; // opaque 32-character lowercase hex ID
  libraryBookId: string | null; // stable book ID, null for temporary sources
  initialPageIndex: number; // saved position clamped to this archive
  title: string; // sanitized file stem, at most 256 Unicode characters
  pages: {
    id: string;
  }
  []; // ordered opaque IDs, at most 10,000
}
```

Temporary sources select the first page; library sources resume saved progress. Dimensions are deliberately absent during indexing.
The frontend validates IDs, title, page count and uniqueness before accepting a
response. The controller suppresses double opens. Late successful responses after
close/unmount are explicitly closed, rather than becoming orphaned sessions.

`request_page(sessionId, pageId, revision)` validates membership and a strictly
increasing safe-integer revision. In V0.4 it returns an independent opaque read
ticket without invalidating other tickets; at most three may coexist. The revision
rejects out-of-order admission only. `release_page(sessionId, ticketId)` replaces
the old revision-based signature: it invalidates exactly that ticket, idempotently,
and cancels its read cooperatively. An old release cannot affect a different ticket.
`close_book(sessionId)` closes only that session, so stale cleanup cannot close a
replacement. Destroying the main window invalidates everything.

The page API uses `convertFileSrc(sessionId + '_' + ticket, 'page')`:

- Linux/macOS: `page://localhost/<session>_<ticket>`.
- Windows: `http://page.localhost/<session>_<ticket>` (or HTTPS when configured).

These are WebView custom protocols, **not network servers**. The asynchronous
protocol checks the requesting window, its current local origin, request Origin
when present, HTTP method, session and ticket. It returns JPEG/PNG bytes with the
correct MIME, width/height headers and `Cache-Control: no-store`; errors are JSON
`{code, message}` with an appropriate status. There are no JSON pixel arrays,
base64 images, global extraction or temporary page files.

The adapter fetches the binary response and creates a single revocable object URL
for the image. Blob URLs let React abort acquisition and revoke the display resource
independently, while preserving structured protocol errors. The production CSP
allows only the exact IPC/media origins, local scripts/styles, and `blob:` images.
CORS echoes only a recognized local origin. No wildcard, remote URL, filesystem
permission or frontend dialog-plugin permission is granted. `build.rs` explicitly
registers all application commands with Tauri's AppManifest; the main local
capability grants twelve application commands. Event listen/unlisten and window
destroy permissions support the normal-close flush handshake. Window/origin checks are additional
checks, not a substitute for that ACL. Native drag/drop path exposure is disabled.

## Work admission, cancellation and resource ownership

At most one open worker (including its picker) and one page worker exist. Page
admission uses an atomic permit **before** `spawn_blocking`; there is no blocking
read queue. If the worker is busy, the current frontend request retries HTTP 409
at 40 ms intervals, at most 250 times (about 10 seconds plus transport time).
The cache serializes acquisitions. Navigation to an uncached destination aborts
other speculative fetch/retry work. Its abort listener releases the exact native
ticket, including when the command reply arrives after cancellation. Foreground
work starts after that acquisition settles; no growing promise/worker queue exists.
A cancelled non-interruptible codec/OS call may still hold the native permit until
it returns. The foreground request retries the existing bounded 409 path meanwhile.

Indexing checks cancellation per entry. Inflation reads at most 16 KiB per step
and checks cancellation before each step; decode is checked before and after. A
codec call and an OS filesystem call cannot be forcibly interrupted. Their input,
dimensions and concurrency are bounded; a slow filesystem may still delay worker
completion. A closed/replaced session keeps a handle only while its single
in-flight worker unwinds. It is no longer accessible by its IDs.

The cache compares the specific entry/acquisition instance as well as the session.
A → B → A reuses retained A, but cannot redisplay a revoked/evicted A resource. Late success disposes
its resource; late errors cannot overwrite a newer page. The old image disappears
immediately on a navigation render. Offscreen Reader effects abort and clear the entire cache, while app-level session metadata stays alive. StrictMode's effect replay
is handled without disposing the live controller.

## Formats, ZIP policy and ordering

Supported: static JPEG and PNG entries, identified for indexing by `.jpg`, `.jpeg`,
`.png` (ASCII case-insensitive); actual MIME comes from the validated signature.
Stored and Deflate compression are supported with `rawzip` and `flate2`'s Rust
backend. WebP and animated PNG are not supported. Rejecting APNG prevents the
WebView from decoding animation frames not covered by the single-page budget.

Archives must have a `.cbz` extension and be regular readable files. Only standard
single-disk ZIPs without a ZIP64 footer, self-extracting prefix or trailing payload
are accepted in V0.2. Names must be ASCII/UTF-8; legacy non-UTF-8 names are rejected.
The central directory and local headers must agree on name and compression.
Overlapping entry ranges, encrypted entries and unsupported compression on needed
image entries are rejected. Every entry, even an ignored file, is checked for
unsafe paths and symlinks before filtering. Both slash conventions are handled
on every host; absolute/drive/UNC/device paths, `..`, empty/dot components, control
characters, colons, trailing dots/spaces and common Windows device basenames are
rejected. Nothing is ever extracted to disk.

Directories, `__MACOSX`, `.DS_Store`, AppleDouble (`._*`) and unsupported files are
ignored. Duplicate names are preserved as distinct entries using their internal
central-directory positions/wayfinders, never a filename map.

Ordering compares full relative paths with separators normalized to `/`:

1. ASCII digit runs compare by numeric magnitude without integer conversion.
2. Equal numeric values put shorter spelling first: `2`, `02`, `002`.
3. ASCII letters compare case-insensitively; other Unicode compares by UTF-8 bytes,
   without locale-dependent collation or Unicode normalization.
4. Ties use the original normalized path bytes, then central-directory index.

Thus `page1`, `page2`, `page10`; folders participate in full-path ordering rather
than being flattened. Corrupt pages remain in the numbering and fail only when
requested, allowing navigation past them.

## Numeric budgets

| Resource                        | Limit                                                     | Enforcement / reason                                                                  |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Archive file                    | 1 GiB                                                     | Reject before parsing; sufficient for the first local reader                          |
| Entries, including ignored ones | 10,000                                                    | Preflight footer/count and actual iteration                                           |
| Central + local header metadata | 8 MiB                                                     | Preflight central extent before library parsing, then cumulative local headers        |
| Encoded page after inflation    | 24 MiB                                                    | Declared compressed/uncompressed sizes plus actual bounded reads; no ratio-only check |
| Image dimensions                | 16,384 per axis, 12,000,000 pixels                        | Checked before the full decoded output allocation                                     |
| Native decoded output           | 96 MiB                                                    | `total_bytes` check plus decoder allocation limits; accommodates bounded 16-bit PNG   |
| Opening / reading jobs          | 1 / 1                                                     | Admission guards, no native read queue                                                |
| Frontend resources              | 1 acquisition, at most 3 blob resources, 1 rendered image | Adjacent working set; revoke on eviction/leave/close; detailed memory budget below    |

The native page payload is at most 24 MiB; JPEG decoding may make another encoded
copy. Decoded output is at most 96 MiB and is dropped before response delivery.
PNG decoder scratch is also configured with a 96 MiB allocation limit. JPEG
scratch scales with the bounded pixel count. In the WebView the app retains at most three 24 MiB blobs and one rendered image;
an RGBA8 surface for 12M pixels is about 46 MiB. The cache uses the additional
decoded-estimate budget described below.
Revoked/aborted resources may be reclaimed asynchronously by the WebView. These
are payload and concurrency budgets, **not a hard process-RSS or GPU-memory cap**;
codec, allocator, transport and compositor overhead is outside application control.
No entire-book decoded allocation is possible. Extremely large scan pages are
rejected rather than resized in this milestone.

The archive remains open by handle; replacing its path does not redirect the
session to a different file. Modifying/truncating the same file in place during a
session is unsupported and can produce structured read/CRC errors. OS calls on
unresponsive storage have no hard wall-clock deadline.

## Errors and postponed work

Stable native codes: `invalid_archive`, `empty_archive`, `encrypted_archive`,
`unsupported_compression`, `unsafe_entry`, `limit_exceeded`, `corrupt_page`,
`read_failed`, `session_expired`, `invalid_page`, `busy`, `forbidden`,
`persistence_failed`, `source_unavailable`, `book_not_found`. Diagnostics
are logged natively; the UI receives concise actionable messages. Adapter codes
include `desktop_unavailable`, `invalid_response`, `communication_failed`.
Library now distinguishes runtime absence from malformed IPC data and failures.

The future PageTransition host remains inside rendering, separate from state and
acquisition; no animation engine exists yet. None/Slide/Fade/Reveal/PageCurl may
later use DOM, Canvas or WebGL and must support reduced motion and LTR/RTL.
Library renderers, Sources, image processing, progress, cache and settings remain
separate domains. Remote formats/providers, disk image caching, spread/continuous
layouts, bookshelf rendering, transitions and installers remain outside V0.5. Native release acceptance is still outstanding.

## V0.3 Reader fundamentals

The V0.3 fitting/input behavior remains. V0.4 changes resource ownership and the
release IPC signature as documented above; the CBZ source and security limits
remain unchanged. Neither milestone adds runtime dependencies beyond V0.2.

- **Acquisition:** `usePage` still depends only on controller/session/page identity.
  The cache owns abort/stale-result/blob disposal; fit and viewport state remain separate.
- **Preferences:** `useReader`, owned by App above screens, holds `ReadingDirection`
  (`ltr` default / `rtl`) and `FitMode` (`page` default / `width` / `height` /
  `original`). These survive screen changes, replacement and close, but not restart.
- **Navigation/input:** the controller still executes canonical `step(1)` and
  `step(-1)`. Only `keyboard.ts` maps physical left/right to those operations:
  right advances in LTR, left advances in RTL. Editable fields, selects, modifiers,
  composition and prevented events remain excluded. Buttons retain logical labels
  and operations; the navigation flex row reverses visually for RTL. Direction
  never changes source order, IDs, fitting, pan coordinates or Rust calls.
- **Composition:** `ReaderPresentation` composes controls and viewport, keyed by
  session ID and canonical page index. This resets local transformations on every
  page change/replacement/close (including A → B → A). Leaving Reader also resets
  transformations and releases the resource, as in V0.2; direction/fit remain.
- **Layout:** `layout.ts` contains pure fit/zoom/clamp calculations. `useViewport`
  observes the actual scroll viewport with ResizeObserver, including scrollbar
  space. For intrinsic image W×H and available w×h, fit scales are `min(w/W,h/H)`,
  `w/W`, `h/H`, and `1`, respectively. Fit Page may upscale small images. The image
  retains its aspect ratio and is centered on axes where it fits; overflowing axes
  start at the top/left and are scrollable. Original Size means intrinsic CSS pixels,
  not physical monitor pixels. Invalid/unmeasured geometry falls back to scale 1.
- **Zoom:** an integer step in [-4,4] gives multiplier `2^(step/2)`, from 0.25 to 4.
  Step zero means the active fit, other steps mean manual zoom relative to it.
  The toolbar explicitly displays a percentage **of fit**, not intrinsic percent.
  Scale is fit scale × multiplier. Resize recomputes fit and retains the multiplier.
  Fit changes reset the step; Reset restores step zero without changing the fit.
  Non-finite inputs are sanitized, and stepping is deterministic, without animation.
- **Pan/input:** `useViewport` operates on native scroll offsets, separate from
  acquisition. A primary pointer drag is admitted only for overflowing content;
  pointer capture keeps it active outside the image. Other pointers/buttons are
  ignored. Offsets clamp to `[0, max(0, contentSize - viewportSize)]` per axis.
  Pointer up/cancel/lost capture stops dragging. Geometry changes cancel capture
  and clamp offsets; changing zoom/fit or pressing Reset returns to top/left.
  Reset also clears pan when already at step zero. A new page starts there too.
  Scrollbars and ordinary vertical keyboard scrolling provide alternatives to drag.
  The input surface excludes all toolbar/navigation controls. Scroll containment
  prevents a drag/overscroll from moving the application shell.

Fit, direction, zoom, reset, pan and resize neither replace the image element nor
reacquire its resource. The single-page presentation can later be wrapped by a
transition host; it does not own or invoke any transition implementation.

Limitations: zoom is fit-relative and anchored at the top/left, not cursor-centered;
there is no inertia, custom trackpad gesture handling, pinch, smooth zoom, animation,
spread, continuous mode, display-preference persistence or additional format. Existing
OS scrollbar behavior remains; this is scrolling within one page, not continuous
book scrolling. No meaningful motion was introduced; Reduced Motion stays compatible.

## V0.4 cache ownership and entry lifecycle

`ReaderController.pages` is the sole PageCache. It owns entries, one running
acquisition, preload selection, errors, eviction and URL disposal. `usePage` uses
`useSyncExternalStore` and selects the canonical page in a layout effect, after DOM
replacement and before paint. It reads by the requested identity even before that
effect, so a ready cached destination is returned immediately and an old page is
never labelled as the new one. The layout-effect ordering protects the currently
committed image from speculative eviction across a navigation commit. The viewport
still consumes the same PageState/PageResource and knows nothing about caching.

Entries are missing, loading, ready, failed, or budget-skipped. Failed/skipped
markers occupy a slot but own no blob. Only active N and valid N+1/N-1 are retained.
There is no fourth page, LRU history, full-book queue, or disk cache. The desired
working set and priority are always `[N, N+1, N-1]`, independent of RTL and recent
direction. A ready navigation target is reused without `request_page`/fetch/archive
read. Its viewport zoom/pan still reset through the existing keyed presentation.

At most one acquisition promise is running. If it is the new foreground target,
it is promoted without a restart. If the foreground is missing, a different
in-flight preload is aborted and removed, even if otherwise nearby. A cached
foreground can coexist with a still-useful preload. Aborted work must settle before
the next acquisition starts; adapter abort immediately releases its native lease.
This deliberately retains one native page worker, zero native queued reads and one
open worker. It does not promise interruption of an already running codec/OS call.
No component makes speculative requests.

### Hard bounds and estimated memory

- Maximum three owned page slots/resources, including the one acquisition; one
  obsolete cancelled acquisition may occupy a slot outside the map until it settles,
  but no replacement acquisition starts before that. No resource-count overshoot.
- Each encoded blob remains bounded by the existing 24 MiB limit: at most 72 MiB
  of retained encoded payload. One image element is rendered; no offscreen decode
  or decoded-image pool has been added.
- Ready entries are trimmed synchronously to **64 MiB of estimated RGBA8 bytes**,
  computed as `width * height * 4`, before subscribers are notified. Active wins,
  then next, then previous. The active is never a trimming candidate. The largest
  accepted active image is 48,000,000 estimated bytes, below this budget, so every
  previously supported page remains displayable.
- Dimensions arrive only after acquisition. Before trimming, at most one incoming
  page can temporarily add 48,000,000 estimated bytes to 64 MiB (under 110 MiB).
  This explicit transient estimate is also bounded by the three-resource count.
  Budget evictions create skipped markers rather than immediately retrying the
  same preload; a skipped target is retried when explicitly selected.
- Blob bytes, browser decoder surfaces, GPU textures, delayed reclamation and IPC
  copies are different allocations. These are ownership/payload and estimation
  bounds, **not a hard process/GPU RSS ceiling**. Pixel/archive/decode limits are
  unchanged. The native ticket limit changes from one to three small metadata
  records; native decode concurrency and its 96 MiB output budget do not increase.

### Native leases and cleanup

A native ticket is a read lease, not a retained native image. The adapter releases
it in a finalizer on success or failure, **before publishing a blob URL**. An abort
listener also invokes that same memoized release, so cancellation reaches a running
native read promptly; finally awaits the same release rather than sending twice.
A cancellation before the ticket reply releases the late ticket without fetching.
Once ready, the cache owns only frontend bytes/URL and no native ticket. Eviction
therefore revokes the URL; any native resource was already released. Evicting an
acquisition aborts its signal, releases its exact ticket, and disposes late success.
Errors from old acquisitions cannot update a replacement entry.

Close/successful replacement clear the old cache; failed or cancelled replacement
preserves it. Leaving Reader clears all entries and aborts work, while retaining
session/index and direction/fit. Returning reacquires the active and neighbors.
StrictMode detach cleanup is deferred one microtask and cancelled by a new lease;
real detach still clears everything. Controller disposal clears immediately and
closes the native session. Native close/replacement/window shutdown invalidate all
tickets even if frontend cleanup cannot run. A broken IPC release surfaces as an
acquisition failure rather than publishing unowned bytes; the native three-ticket
cap and session teardown remain the fallback bounds.

### Errors and limitations

A speculative failure is local to its entry and never overwrites the active page.
Selecting that failed neighbor retries it once as foreground. A foreground failure
is shown for that page; it stays cached while nearby, and is retried after eviction
or leaving/returning to Reader. Other pages remain usable. There is no automatic
retry loop for corrupt pages or budget-skipped preloads.

This caches encoded resources, not guaranteed decoded WebView surfaces. Cached
navigation removes archive/transport latency, but a browser image onLoad/decode can
still briefly show loading. Very large neighbors may be discarded after one bounded
read, and reverse reading keeps the simple next-before-previous policy. No disk
page cache, pre-decoding pool, animations, spreads or remote sources are added.

## Persistent Library (V0.5)

The dependency flow is React → validated `shared/ipc/library.ts` → thin commands
→ `core::library::Library` → `library/repository.rs` → SQLite. Domain types have no
Tauri dependency. `library/progress.rs` owns the write worker. Database-open errors
are retained as typed service errors, allowing the UI and temporary Reader to
remain usable. SQL and paths never cross IPC; diagnostics stay native.

### Storage and migration

Setup resolves Tauri `app_data_dir()`, creates it and opens `library.sqlite3`. On
Linux this normally means `$XDG_DATA_HOME/dev.mangareader.desktop/` (fallback
`~/.local/share`); macOS/Windows use Tauri's platform application-data directory.
`rusqlite` uses bundled SQLite, no ORM, default journal/durability settings and a
two-second busy timeout. `PRAGMA user_version` is the migration identifier: version
0 creates version 1 in one transaction; version 1 validates records/schema, and
future versions or malformed databases return `persistence_failed`. No destructive
automatic database reset is performed.

One `books` table holds `id`, `source_kind`, `source_ref`, `title`, `page_count`,
`added_at`, `opened_at`, `progress_index`, `progress_count`, `read_at`, `completed`.
Progress is nullable until navigation; timestamps are epoch milliseconds. Stable
UUID-derived opaque IDs are independent of Reader/session/page/ticket IDs.
`source_kind` currently accepts `local_cbz`; future sources require an explicit
migration/implementation, not speculative tables. `source_ref` is an absolute
native path BLOB (Unix bytes or Windows UTF-16LE), never a frontend string. Database
portability between operating systems is not promised. SQL constraints and read
validation reject unexpected counts, IDs, kinds, timestamps and partial progress.

### Import, identity and availability

Add Books uses the existing Rust dialog plugin with multiple selection, maximum
100 candidates. A single admitted library operation processes candidates serially:
canonicalize path → existing safe CBZ index validation outside the DB lock →
short insertion transaction. Per-file results distinguish imported, duplicate and
failed using sanitized titles and typed errors. It does not hash or decode every
page; later corrupt page data still produces the existing page-local error.

A UNIQUE constraint on `(source_kind, source_ref)` deduplicates canonical paths,
including symlink aliases. Copies, hard links, case aliases not resolved by the OS,
and moved files are not content-deduplicated. The catalog is bounded to 10,000
records. Default ordering is last opened/recently added descending, then stable ID.
There is no search, additional sort UI, series inference or filesystem crawling.

Availability is checked outside the DB lock on listing/opening. A regular file's
existence does not guarantee a valid readable archive; open validates it again.
Missing entries remain listed and produce recoverable `source_unavailable` errors.
Restore the original path and refresh/reopen; no watcher or relinking is included.
Remove from Library deletes only the row. An already-open Reader may continue;
late progress UPDATEs cannot recreate a removed record.

### Progress, resume and consistency

Actual logical page-index changes queue progress, independent of image/preload
completion. A corrupt page can therefore be the saved position. Opening a book
alone updates last-opened time but never marks completion. Frontend progress has
one IPC in flight and one replaceable latest pending update. Rust validates the
active session, range and increasing progress revision, derives the trusted book
ID/count from the session, then admits it to one dedicated worker with one latest
pending update. There is no growing write queue or page-turn wait for SQLite.
Temporary sessions produce no persistent progress. Ticket revisions remain separate.

Admission acknowledgment is not a durability acknowledgment. Flush waits for the
latest SQLite write before replacement/close and Library/Home refresh. Failed writes
retain the latest update, surface a typed error and stop automatic retries until
flush retries; failure does not silently close/replace the current Reader. The
normal Tauri close-request handler freezes navigation, awaits flush, and permits
destruction only on success. Native destruction also flushes/joins as a fallback.
Unexpected termination/power loss can lose pending updates; no crash-proof final
page guarantee is made.

Opening by stable ID flushes progress, loads the native reference, indexes outside
the DB lock, clamps the saved index to `0..new_count-1`, and commits through the
existing Reader session abstraction. No saved progress means index zero. A short
last-opened metadata update runs under the Reader commit lock after cancellation
validation; DB failure preserves the previous session. No archive/image decoding
is performed under that lock or a database transaction. The service admits one
general library job before spawning; the existing one Reader-open and one page
worker limits remain, plus one progress worker.

New imports are unread. Successful open makes an unread book reading. Navigation
onto the final page marks completed; moving back clears it. Completion never blocks
opening or re-reading. A single-page book stays reading because opening is not a
completion event. Page count is refreshed on open; the recorded progress count
retains the count at its last write until the next navigation update.

### Presentation and scope

Library cards show real titles, progress/status, unavailable state and explicit
metadata-only removal. Home Continue Reading shares the same open/resume flow.
Placeholder covers intentionally avoid an extra decode/storage pipeline. A future
V0.6 should generate bounded, regenerable thumbnails stored separately from SQLite
and source comics, with opaque delivery. No V0.6 implementation is included.
Preferences, page bytes and cache resources are not persisted. Existing V0.4 cache
bounds and cleanup remain unchanged. There is no series model, relinking, cloud
sync, disk image cache, new format or immersive bookshelf.

## V0.6 canonical pages and presentation groups

V0.6 supersedes the single-active-page details above; source order, archive limits,
opaque identities, native worker admission and SQLite schema remain unchanged.
`features/reader/presentation.ts` is the pure planner. It groups canonical indices
into one or two pages. Single gives `[0],[1],…`; Double gives `[0,1],[2,3],…`.
Cover alone isolates zero and pairs from one. Odd tails are alone, never padded
with a manufactured page. `ReaderController` owns mode (Single default), cover
isolation (off default), requested canonical index and current group. Settings
survive screen changes and source replacement, but are not persisted.

### Dimensions and conservative wide classification

`width / height >= 1.2` means wide, in exactly one planner helper. Wide pages stand
alone and reset subsequent pairing. This is an aspect-ratio heuristic, not panel
analysis or automatic splitting. Dimensions reuse validated native page resources;
there is no extra decode, whole-book scan or new native metadata command.

Dimensions are discovered lazily through the existing foreground/preload path.
Unknown pages provisionally pair; a Double presentation waits until each candidate
has dimensions or a terminal acquisition error before rendering its slots. A
failed unknown page is provisionally treated as normal so its error and successful
neighbor can display; a successful retry may subsequently classify it as wide.
The controller retains only known/wide index sets (at most 10,000 indices each),
not image resources. They survive cache eviction and screen changes and clear on
successful session replacement. New metadata replans around the **requested
canonical page**, including when the second candidate proves to be wide. It never
pairs a known wide page. Discovering an earlier wide page can change later pairing;
a distant jump does not scan all intervening pages. This incremental planning is
an explicit V0.6 limitation, avoiding a slow unbounded opening pass. Metadata is
session-local, so a newly reopened source starts classification again.

### Direction, navigation, progress and completion

Grouping is direction-independent. Only the viewport reverses a group's visual
slots for RTL: `[12,13]` becomes left 13/right 12. Physical arrows retain the
existing mapping to logical Previous/Next; those operations now move by group.
Mode/cover changes do not reopen the source. Single → Double contains the requested
page; Double → Single chooses the group's lowest canonical index, irrespective of
visual direction. Cover changes preserve containment of the requested page.

The compact Go to page form accepts whole decimal numbers from 1 through the page
count and maps them to zero-based indices. Blank, nonnumeric, fractional, signed,
zero, negative and out-of-range values show a validation error and leave the group
unchanged. In Double it selects the group containing the requested page. The
indicator uses canonical order (`126–127 / 238`), even in RTL. Typing in the input
does not trigger Reader arrow shortcuts. Controls use labels, semantic form/input/
buttons, accessible validation and current-page status.

Persisted progress is always the lowest canonical index in the current group.
Navigation retains V0.5's logical-turn semantics (including a page with a display
error), coalescing and flush guarantees. Metadata regrouping after navigation
updates that anchor. Opening or changing settings alone sends no progress; once
all slots of a final group have actually emitted successful image load events,
that presentation also records completion. This fixes one-page books: acquisition
or import alone does not complete them, successful display does. Duplicate load
notifications and stale sessions are ignored. Backward navigation records an
incomplete group and returns the book to Reading. Resume places the saved canonical
index into the current mode's group; restart defaults to Single.

`record_progress` now accepts an optional last canonical index, defaulting to the
anchor for compatibility. Rust validates current session, increasing revision,
range and a contiguous span of at most two pages. The span's endpoint determines
completion, while only its anchor is stored as progress. The existing `completed`
column is reused: **user_version stays 1, no migration or new table/column**.
Rust has no knowledge of visual slots or RTL. Temporary CBZs still never save
Library progress. The one native progress worker and latest-only queue are unchanged.

### One composed viewport

`usePresentation` selects one active set from the sole PageCache after the DOM
commit. `ReaderPresentation` is keyed by session, mode, cover and canonical group,
resetting zoom/pan on grouping changes. Slots read resources by session/page ID;
late results cannot assemble an old page into a new group. After classification,
slots may load progressively and show contained errors with Retry page buttons.
Retry preserves successful neighboring resources. Speculative errors stay local.

The composed intrinsic width is the sum of page widths plus an 8 CSS-pixel gutter;
height is the maximum page height. A single common scale applies Fit Page/Width/
Height/Original Size and zoom to both pages and the gutter. Pages retain their
individual aspect ratios and intrinsic relative sizes, vertically centered. Errors
without dimensions use a 320×480 placeholder for geometry only, not a fake source
page. Pan operates on one scroll surface. Mode/cover/group/wide regrouping resets
transforms; fit resets zoom, resize recomputes fit while retaining zoom and clamping
pan. Settings, zoom, pan and resize do not acquire resources.

### Active-set cache, preloading and bounds

PageCache remains the only resource owner. All one or two active indices are
pinned. Desired priority is current canonical group, then the next planned group,
then the previous planned group, truncated to **three** unique canonical indices.
Thus a normal pair has room for one page of the next spread; a lone wide/cover page
can preload both pages of the next spread. Near the end, previous-group resources
can be retained. Direction does not change this policy. Known wide metadata feeds
the same planner used for navigation; unknown future pages remain provisional.

There is one frontend acquisition, one native page worker and no growing queue.
An uncached foreground set/retry cancels unrelated speculation; work must settle
before another acquisition starts. A useful in-flight target is promoted. All
active resources survive eviction; speculative failures/budget skips own no bytes.
Close, replacement, detach and stale success disposal retain V0.4 ownership rules.

Bounds:

- Three resource/acquisition slots maximum, unchanged from V0.4/V0.5.
- Normal estimated RGBA retention budget remains 64 MiB.
- Two active maximum-sized pages may exceed this target: at most 24,000,000 pixels
  or **96,000,000 bytes (~91.6 MiB)** combined. They remain readable and speculation
  is skipped. The budget exception is only for active pages, never their neighbors.
- A single acquisition can temporarily add at most 48,000,000 estimated bytes to
  a normal-budget working set before trimming: **under 110 MiB** estimated peak.
  Once the active set exceeds 64 MiB, no speculative acquisition starts. A new
  active acquisition alongside one maximum-sized active page stays below that peak.
- Encoded payloads remain at most three × 24 MiB. At most two rendered images,
  instead of one, are necessary for Double. Native decoding/ticket limits do not
  change. Browser allocator, decode, transport and compositor overhead still mean
  these are ownership/payload estimates, not a process/GPU RSS guarantee.

No Reader page disk cache, preference persistence, source splitting,
transition/animation, continuous mode, new format or series model is introduced.
Native visual acceptance remains outstanding.

### Persistent covers and Library presentation (V0.7)

The SQLite `Book`/Library DTO remains metadata-only. A separate React `BookVisual`
renders a stable cover frame, native cover image or deterministic title/CBZ fallback,
progress and availability/completion markers. Library and Home Continue Reading
reuse `BookCard`/`BookVisual`; a future renderer can consume the same presentation
data for a list or shelf. Cover aspect ratio is retained inside a stable frame; no
crop or upscale is applied. The modest elevation uses CSS and honors reduced motion.

Persistent import still validates and inserts the CBZ first. Cover creation is
best-effort and does not roll back a valid entry. It reopens the same safe `CbzSource`
and reads canonical image pages in order until the first page that passes the
existing CRC, byte, dimension, pixel and decode limits. One image is decoded at a
time; a single shared admission flag bounds cover generation to one worker. A cover
is resized (Lanczos) to at most 360 pixels on its long edge, never upscaled, then
encoded as PNG. The full page is never transferred to React. Per-image working
memory inherits the CBZ decoder limit; encoded cache reads are capped at 1 MiB.

Derived PNGs and a 20-byte source stamp live under Tauri's platform-provided
application-data directory in `covers/<opaque-book-id>.png` and `.stamp`. Writes
use opaque temporary names and atomic rename. The stamp contains source length and
modification time (seconds and nanoseconds); this avoids hashing the archive. A
same-size replacement whose timestamp is preserved can evade invalidation. Missing
or stale covers regenerate on demand through a custom `cover` resource scheme, also
used by Home and Library. `convertFileSrc` receives only the validated opaque book
ID. The media handler checks the main window, allowed origin, GET and ID syntax;
CSP explicitly permits only the app's cover protocol origins. No native path or
arbitrary file URL reaches React.

Existing schema-v1 records remain unchanged and usable. Their first visible image
requests lazily create a cover; import-time generation is synchronous but serial
within the already bounded import operation. Cover availability stays out of the
Book DTO; a failed request shows the same deterministic fallback with an explicit
retry action when the source remains available.
Missing sources retain and serve any bounded cached PNG; missing sources with no
thumbnail show the fallback while the stored title remains visible. A broken cover
does not alter book availability. No schema migration or physical thickness value
is introduced; spine/thickness are deferred until the future renderer needs them.

### Library renderer boundary and Shelf (V0.8)

`useLibrary` remains the single owner of loaded Library DTOs and refresh behavior.
`presentBook` derives display status/page labels, progress percent, stable muted
fallback tone, visual height and bounded thickness without mutating or persisting
the Book. Both `LibraryGrid` and `BookShelf` receive the same ordered list and
callbacks through `LibraryRenderer`; the in-memory Grid/Shelf switch is owned by
`LibraryScreen`. Search remains unchanged (there is no search/filter feature yet).
This leaves room for a Classic List renderer without changing persistence.

The Shelf renderer lays each book into a responsive CSS grid with fixed-size shelf
rows; rows wrap naturally instead of compressing the books. Each slot renders a
3D-transformed spine with a wood plank/contact shadow, restrained wall shading,
small deterministic height variation and thickness bands derived from page count
(9–22 CSS pixels, 14 px for unknown/invalid counts). Those values are strictly
visual hints, not physical dimensions. A stable ID hash selects the fallback tone
and height, so rerenders do not shuffle books. Completion/unavailable markers remain
subtle; status and progress remain available in accessible text and the selected
details card. The existing `BookVisual` and cover URI are reused in that card and
the Grid renderer; Shelf mode does not parse full-resolution pages or create a
second cover pipeline.

Selecting a spine is a semantic toggle button, so keyboard Enter/Space and pointer
activation select the same item. Selection only reveals a small details preview;
it does not mark the item opened, alter progress or construct a Reader session. The
existing Open/Resume button is the sole selection-to-Reader boundary and calls the
same persistent open callback as Grid. The preview reuses `BookCard`, including
the recoverable unavailable state. Home remains a practical Continue Reading card.

Hover/focus/selection use short CSS transforms and shadows; `prefers-reduced-motion`
removes movement and the details entrance animation while preserving focus and
selection indicators. Pointer motion does not drive React state. Grid remains the
default until native Shelf visual acceptance. Shelf is a foundation only: there is
no book-flight/cinematic open, camera, physical cover mesh, row persistence,
virtualization, Classic List, new database field, or 3D engine. Layout/performance
has been exercised with 30 items in UI tests, not benchmarked at very large counts.

## Linux runtime compatibility (V0.6.1)

The optional Linux-only `tools/dev-wayland-compat.sh` launcher sets
`__NV_DISABLE_EXPLICIT_SYNC=1` before delegating to the unchanged `bun run dev`.
This addresses the observed WebKitGTK/GTK/NVIDIA Wayland startup interaction. It
does not belong to Reader, PageCache, spread planning or Library. No domain code,
SQLite migration, dependency or production startup flag changes. The ordinary dev
command remains the upstream retest path; remove compatibility flags from the
calling environment before comparison. The helper adds no X11/DMABUF-disable flags.

Automatic production detection is intentionally not implemented: it would need to
distinguish affected NVIDIA rendering from merely installed GPUs on hybrid hosts,
verify the active Wayland backend, account for fixed/backported WebKitGTK versions,
and offer an explicit opt-out. Effects on non-NVIDIA configurations were not
measured, so no broad safety claim is made. Once a fixed system build passes native
acceptance without the variable, use the ordinary launcher. This is separate from
application logic and does not require changing rendering architecture.
