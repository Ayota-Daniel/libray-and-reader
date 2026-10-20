import { afterEach, expect, test, spyOn } from 'bun:test';
import { mockIPC, clearMocks, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { parseSession, readerApi } from '../src/shared/ipc/reader';
import { listBooks } from '../src/shared/ipc/library';
import { book } from './reader-fixtures';
import { navigationDelta } from '../src/features/reader/keyboard';

afterEach(() => {
  clearMocks();
  Object.assign(globalThis, { isTauri: false });
});
test('metadata boundary rejects malformed, duplicated and oversized responses', () => {
  expect(parseSession(book)).toEqual(book);
  expect(parseSession(null)).toBeNull();
  for (const data of [
    undefined,
    {},
    { ...book, sessionId: '../path' },
    { ...book, title: '' },
    { ...book, pages: [] },
    { ...book, pages: [{ id: 'bad' }] },
    { ...book, pages: [book.pages[0], book.pages[0]] },
    { ...book, title: 'x'.repeat(257) },
  ]) {
    expect(() => parseSession(data)).toThrow();
  }
});
test('Library distinguishes missing runtime and invalid IPC data', async () => {
  Object.assign(globalThis, { isTauri: false });
  await expect(listBooks()).rejects.toMatchObject({
    code: 'desktop_unavailable',
  });
  Object.assign(globalThis, { isTauri: true });
  mockIPC(() => ({ malformed: true }));
  await expect(listBooks()).rejects.toMatchObject({ code: 'invalid_response' });
  mockIPC(() => []);
  expect(await listBooks()).toEqual([]);
});
test('keyboard mapping stays contextual and preserves editable controls', () => {
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
  expect(navigationDelta(event, null, true)).toBe(1);
  expect(navigationDelta(event, null, false)).toBeNull();
  for (const tag of ['input', 'textarea', 'select'])
    expect(
      navigationDelta(event, document.createElement(tag), true),
    ).toBeNull();
  expect(
    navigationDelta(
      new KeyboardEvent('keydown', { key: 'Enter' }),
      document.createElement('button'),
      true,
    ),
  ).toBeNull();
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const child = document.createElement('span');
  editable.append(child);
  expect(navigationDelta(event, child, true)).toBeNull();
  expect(
    navigationDelta(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }),
      null,
      true,
    ),
  ).toBeNull();
});

test('media adapter uses opaque protocol URLs, binary blobs and idempotent disposal', async () => {
  Object.assign(globalThis, { isTauri: true });
  mockIPC(() => 'c'.repeat(32));
  mockConvertFileSrc('linux');
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Uint8Array([137, 80]), {
      headers: {
        'Content-Type': 'image/png',
        'X-Page-Width': '2',
        'X-Page-Height': '3',
      },
    }),
  );
  const revoke = spyOn(URL, 'revokeObjectURL');
  try {
    const page = await readerApi.loadPage(
      book.sessionId,
      book.pages[0]!.id,
      1,
      new AbortController().signal,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `page://localhost/${book.sessionId}_${'c'.repeat(32)}`,
    );
    expect(page.width).toBe(2);
    expect(page.url.startsWith('blob:')).toBe(true);
    page.dispose();
    page.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
  } finally {
    fetchMock.mockRestore();
    revoke.mockRestore();
  }
});

test('media busy retry keeps the current ticket and preserves structured page failures', async () => {
  Object.assign(globalThis, { isTauri: true });
  mockIPC(() => 'c'.repeat(32));
  mockConvertFileSrc('windows');
  const fetchMock = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'busy', message: 'Busy' }), {
        status: 409,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'corrupt_page', message: 'Damaged page' }),
        { status: 422 },
      ),
    );
  try {
    await expect(
      readerApi.loadPage(
        book.sessionId,
        book.pages[0]!.id,
        1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'corrupt_page' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('page.localhost');
  } finally {
    fetchMock.mockRestore();
  }
});

test('media adapter rejects malformed dimensions and honours an already aborted request', async () => {
  Object.assign(globalThis, { isTauri: true });
  mockIPC(() => 'c'.repeat(32));
  mockConvertFileSrc('linux');
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Uint8Array([1]), {
      headers: {
        'Content-Type': 'image/png',
        'X-Page-Width': '999999',
        'X-Page-Height': '1',
      },
    }),
  );
  try {
    await expect(
      readerApi.loadPage(
        book.sessionId,
        book.pages[0]!.id,
        1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const abort = new AbortController();
    abort.abort();
    await expect(
      readerApi.loadPage(book.sessionId, book.pages[0]!.id, 2, abort.signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    fetchMock.mockRestore();
  }
});
