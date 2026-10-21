import { convertFileSrc } from '@tauri-apps/api/core';
import type { ReaderApi, ReadingSession } from '../../features/reader/model';
import {
  desktopInvoke,
  DesktopError,
  failure,
  invalidResponse,
} from './errors';

const MAX_PAGES = 10_000;
const MAX_BYTES = 24 * 1024 * 1024;
export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}
export function parseSession(value: unknown): ReadingSession | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !('sessionId' in value) ||
    !isId(value.sessionId) ||
    !('title' in value) ||
    typeof value.title !== 'string' ||
    !value.title.length ||
    [...value.title].length > 256 ||
    !('pages' in value) ||
    !Array.isArray(value.pages) ||
    value.pages.length === 0 ||
    value.pages.length > MAX_PAGES
  )
    return invalidResponse();
  const ids = new Set<string>();
  for (const page of value.pages as unknown[]) {
    if (
      typeof page !== 'object' ||
      page === null ||
      !('id' in page) ||
      !isId(page.id) ||
      ids.has(page.id)
    )
      return invalidResponse();
    ids.add(page.id);
  }
  const resume = 'initialPageIndex' in value ? value.initialPageIndex : 0;
  const libraryId = 'libraryBookId' in value ? value.libraryBookId : null;
  if (
    typeof resume !== 'number' ||
    !Number.isSafeInteger(resume) ||
    resume < 0 ||
    resume >= ids.size ||
    (libraryId !== null && !isId(libraryId))
  )
    return invalidResponse();
  return {
    ...(libraryId ? { libraryBookId: libraryId } : {}),
    ...(resume ? { initialPageIndex: resume } : {}),
    sessionId: value.sessionId,
    title: value.title,
    pages: [...ids].map((id) => ({ id })),
  };
}
function parseId(value: unknown): string {
  return isId(value) ? value : invalidResponse();
}
async function emptyCommand(command: string, args: Record<string, unknown>) {
  if ((await desktopInvoke(command, args)) !== null) invalidResponse();
}
function cancelled(signal: AbortSignal) {
  signal.throwIfAborted();
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 40);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export const readerApi: ReaderApi = {
  async openLibrary(operationId, bookId) {
    const session = parseSession(
      await desktopInvoke('open_library_book', { operationId, bookId }),
    );
    return session ?? invalidResponse();
  },
  recordProgress: (sessionId, pageIndex, revision) =>
    emptyCommand('record_progress', { sessionId, pageIndex, revision }),
  flushProgress: () => emptyCommand('flush_progress', {}),
  async beginOpen() {
    return parseId(await desktopInvoke('begin_open'));
  },
  async openSelected(operationId) {
    return parseSession(await desktopInvoke('open_selected', { operationId }));
  },
  cancelOpen: (operationId) => emptyCommand('cancel_open', { operationId }),
  closeBook: (sessionId) => emptyCommand('close_book', { sessionId }),
  async loadPage(sessionId, pageId, revision, signal) {
    cancelled(signal);
    const ticket = parseId(
      await desktopInvoke('request_page', { sessionId, pageId, revision }),
    );
    let releasing: Promise<void> | undefined;
    const release = () =>
      (releasing ??= emptyCommand('release_page', {
        sessionId,
        ticketId: ticket,
      }).catch((error) => {
        if (failure(error).code !== 'session_expired') throw error;
      }));
    const onAbort = () => {
      void release().catch(() => {
        /* Finalizer observes this failure. */
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let blob: Blob;
    let width: number;
    let height: number;
    try {
      cancelled(signal);
      // convertFileSrc handles page://localhost on Linux/macOS and
      // http(s)://page.localhost on Windows. The path contains only opaque IDs.
      const url = convertFileSrc(`${sessionId}_${ticket}`, 'page');
      let response: Response | undefined;
      for (let attempt = 0; attempt < 250; attempt++) {
        cancelled(signal);
        response = await fetch(url, { signal, cache: 'no-store' });
        if (response.status !== 409 || attempt === 249) break;
        await response.body?.cancel();
        await pause(signal);
      }
      cancelled(signal);
      if (!response) return invalidResponse();
      if (!response.ok) {
        const error = failure(await response.json());
        throw new DesktopError(error.code, error.message);
      }
      const mime = response.headers.get('Content-Type');
      width = Number(response.headers.get('X-Page-Width'));
      height = Number(response.headers.get('X-Page-Height'));
      if (
        !['image/png', 'image/jpeg'].includes(mime ?? '') ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 16_384 ||
        height > 16_384 ||
        width * height > 12_000_000
      )
        return invalidResponse();
      blob = await response.blob();
      cancelled(signal);
      if (blob.size === 0 || blob.size > MAX_BYTES) return invalidResponse();
    } finally {
      signal.removeEventListener('abort', onAbort);
      await release();
    }
    cancelled(signal);
    // Native owns only the bounded read lease, not these frontend bytes.
    const objectUrl = URL.createObjectURL(blob);
    let disposed = false;
    return {
      url: objectUrl,
      width,
      height,
      dispose() {
        if (!disposed) {
          disposed = true;
          URL.revokeObjectURL(objectUrl);
        }
      },
    };
  },
};
