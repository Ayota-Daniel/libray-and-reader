# V0.4 architecture

One React application, one Rust crate, Tauri 2. This milestone reads a single local
CBZ at a time. Opening a book is **not** a Library import. Sessions and positions
are volatile and disappear when the application exits. No database, HTTP server,
remote provider or persistence has been introduced. V0.4 adds only a bounded
in-memory page working set.

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

Library still returns a real empty catalog from Rust; its state and grid renderer
remain independent. Home has no fabricated recent activity. Future list/shelf
renderers consume catalog metadata, not source implementation details.

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
  title: string; // sanitized file stem, at most 256 Unicode characters
  pages: {
    id: string;
  }
  []; // ordered opaque IDs, at most 10,000
}
```

The first page is selected. Dimensions are deliberately absent during indexing.
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
capability grants only these seven commands. Window/origin checks are additional
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
`read_failed`, `session_expired`, `invalid_page`, `busy`, `forbidden`. Diagnostics
are logged natively; the UI receives concise actionable messages. Adapter codes
include `desktop_unavailable`, `invalid_response`, `communication_failed`.
Library now distinguishes runtime absence from malformed IPC data and failures.

The future PageTransition host remains inside rendering, separate from state and
acquisition; no animation engine exists yet. None/Slide/Fade/Reveal/PageCurl may
later use DOM, Canvas or WebGL and must support reduced motion and LTR/RTL.
Library renderers, Sources, image processing, progress, cache and settings remain
separate domains. Persistence, remote formats/providers, disk caching,
spread/continuous layouts, bookshelf rendering, transitions and installers remain
outside V0.4. Native release acceptance is still outstanding.

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
spread, continuous mode, persistence or additional format. Existing
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
read, and reverse reading keeps the simple next-before-previous policy. No persistence,
pre-decoding pool, animations, spreads, formats, remote sources or V0.5 work is added.
