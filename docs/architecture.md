# V0.2 architecture

One React application, one Rust crate, Tauri 2. This milestone reads a single local
CBZ at a time. Opening a book is **not** a Library import. Sessions and positions
are volatile and disappear when the application exits. No database, HTTP server,
remote provider, cache framework, or persistence has been introduced.

## Ownership

- `app/App.tsx` owns the `useReader` controller above the screens. Moving between
  screens preserves the current session and page index.
- `features/reader/controller.ts` owns open/replace/close state and logical
  navigation. It contains no archive, path, or WebView transport implementation.
- `usePage` owns the active screen's abort controller and one page resource.
  `ReaderViewport` renders it; `ReaderNavigation` renders controls. Keyboard mapping
  is separate from logical previous/next, leaving future RTL possible.
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
increasing safe-integer revision. It invalidates the previous request and returns
an opaque resource ticket. `release_page(sessionId, revision)` invalidates current
or older tickets; out-of-order cleanup cannot invalidate a newer request.
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
Navigation aborts old fetch/retry work. Every new revision invalidates old native
work, even if its JavaScript promise is abandoned.

Indexing checks cancellation per entry. Inflation reads at most 16 KiB per step
and checks cancellation before each step; decode is checked before and after. A
codec call and an OS filesystem call cannot be forcibly interrupted. Their input,
dimensions and concurrency are bounded; a slow filesystem may still delay worker
completion. A closed/replaced session keeps a handle only while its single
in-flight worker unwinds. It is no longer accessible by its IDs.

React compares the specific acquisition instance as well as the session/page IDs.
Even A → B → A cannot redisplay an already revoked A resource. Late success disposes
its resource; late errors cannot overwrite a newer page. The old image disappears
immediately on a navigation render. Offscreen Reader effects abort and release
media, while app-level session metadata stays alive. StrictMode's effect replay
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

| Resource                        | Limit                              | Enforcement / reason                                                                  |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Archive file                    | 1 GiB                              | Reject before parsing; sufficient for the first local reader                          |
| Entries, including ignored ones | 10,000                             | Preflight footer/count and actual iteration                                           |
| Central + local header metadata | 8 MiB                              | Preflight central extent before library parsing, then cumulative local headers        |
| Encoded page after inflation    | 24 MiB                             | Declared compressed/uncompressed sizes plus actual bounded reads; no ratio-only check |
| Image dimensions                | 16,384 per axis, 12,000,000 pixels | Checked before the full decoded output allocation                                     |
| Native decoded output           | 96 MiB                             | `total_bytes` check plus decoder allocation limits; accommodates bounded 16-bit PNG   |
| Opening / reading jobs          | 1 / 1                              | Admission guards, no native read queue                                                |
| Frontend resources              | 1 fetch, 1 blob URL, 1 image       | Abort/revoke at change, leave, close and unmount; no preload/cache                    |

The native page payload is at most 24 MiB; JPEG decoding may make another encoded
copy. Decoded output is at most 96 MiB and is dropped before response delivery.
PNG decoder scratch is also configured with a 96 MiB allocation limit. JPEG
scratch scales with the bounded pixel count. In the WebView the app retains at
most one 24 MiB blob and one image; an RGBA8 surface for 12M pixels is about 46 MiB.
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
separate domains. Persistence, remote formats/providers, caching/preloading,
advanced layouts/zoom, bookshelf rendering, transitions and installers are all
outside V0.2. Validate the native Linux flow before selecting another feature milestone.
