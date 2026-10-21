import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/app/App';
import type {
  LibraryApi,
  LibraryBook,
  ImportResult,
} from '../src/features/library/model';
import { book, fakeApi } from './reader-fixtures';
import { parseBooks } from '../src/shared/ipc/library';
let root: Root | undefined;
let host: HTMLDivElement;
const saved: LibraryBook = {
  id: '9'.repeat(32),
  sourceKind: 'local_cbz',
  title: 'Volume One',
  pageCount: 3,
  addedAt: 1,
  lastOpenedAt: null,
  lastPageIndex: null,
  progressPageCount: null,
  lastReadAt: null,
  status: 'unread',
  available: true,
};
function fixture(initial: LibraryBook[] = []) {
  let books = initial.map((b) => ({ ...b }));
  const { api: reader, loaded } = fakeApi();
  const removed: string[] = [];
  let imports: ImportResult[] = [
    { title: saved.title, outcome: 'imported', error: null },
  ];
  const library: LibraryApi = {
    list: async () => books.map((b) => ({ ...b })),
    add: async () => {
      if (!books.length) books = [{ ...saved }];
      return imports;
    },
    remove: async (id) => {
      removed.push(id);
      books = books.filter((b) => b.id !== id);
    },
  };
  reader.openLibrary = async (_operation, id) => {
    const row = books.find((b) => b.id === id)!;
    if (!row.available)
      throw {
        code: 'source_unavailable',
        message: 'Restore the original file and try again.',
      };
    row.lastOpenedAt = 100;
    if (row.status === 'unread') row.status = 'reading';
    return {
      ...book,
      libraryBookId: id,
      title: row.title,
      pages: [...book.pages, { id: '3'.repeat(32) }],
      initialPageIndex: row.lastPageIndex ?? 0,
    };
  };
  reader.recordProgress = async (_session, index) => {
    const row = books[0]!;
    row.lastPageIndex = index;
    row.progressPageCount = 3;
    row.lastReadAt = 101;
    row.status = index === 2 ? 'completed' : 'reading';
  };
  reader.flushProgress = async () => {};
  return {
    reader,
    library,
    loaded,
    removed,
    setImports: (value: ImportResult[]) => {
      imports = value;
    },
    books: () => books,
  };
}
async function mount(data: ReturnType<typeof fixture>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App readerApi={data.reader} libraryApi={data.library} />);
  });
}
async function click(label: string) {
  const target = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  );
  if (!target) throw new Error(`Missing ${label}`);
  await act(async () => target.click());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
});

test('empty library, batch import, duplicate and invalid results use real metadata', async () => {
  const data = fixture();
  await mount(data);
  await click('Library');
  expect(host.textContent).toContain('Your library is empty');
  data.setImports([
    { title: 'Volume One', outcome: 'imported', error: null },
    { title: 'Volume One', outcome: 'duplicate', error: null },
    {
      title: 'Bad',
      outcome: 'failed',
      error: { code: 'invalid_archive', message: 'Invalid archive' },
    },
  ]);
  await click('Add Books');
  expect(host.textContent).toContain(
    '1 imported · 1 already in library · 1 failed',
  );
  expect(host.textContent).toContain('Invalid archive');
  expect(host.textContent).toContain('Volume One');
  expect(host.textContent).toContain('Unread · 3 pages');
  await click('Remove from Library');
  expect(data.removed).toEqual([saved.id]);
  expect(host.textContent).toContain('Your library is empty');
  expect(host.textContent).not.toContain('Delete File');
});
test('opening saved library progress uses the same Reader and refreshes progress/completion on return', async () => {
  const data = fixture([
    {
      ...saved,
      lastOpenedAt: 5,
      lastPageIndex: 1,
      progressPageCount: 3,
      lastReadAt: 6,
      status: 'reading',
    },
  ]);
  await mount(data);
  await click('Library');
  expect(host.textContent).toContain('Page 2 / 3');
  await click('Resume reading');
  expect(host.textContent).toContain('2 / 3');
  expect(data.loaded[0]?.pageId).toBe(book.pages[1]!.id);
  await click('Next page');
  await click('Library');
  expect(host.textContent).toContain('Completed · Page 3 / 3');
  await click('Resume reading');
  expect(host.textContent).toContain('3 / 3');
  await click('Previous page');
  await click('Library');
  expect(host.textContent).toContain('Reading · Page 2 / 3');
});
test('Home Continue Reading opens persistent identity; direct Open CBZ never imports', async () => {
  const data = fixture([
    {
      ...saved,
      lastOpenedAt: 10,
      lastPageIndex: 1,
      progressPageCount: 3,
      lastReadAt: 20,
      status: 'reading',
    },
  ]);
  await mount(data);
  expect(host.textContent).toContain('Continue Reading');
  await click('Resume reading');
  expect(host.textContent).toContain('2 / 3');
  await click('Close book');
  await click('Open CBZ');
  await click('Next page');
  await click('Library');
  expect(data.books()).toHaveLength(1);
  expect(data.books()[0]?.lastPageIndex).toBe(1);
  expect(host.textContent).toContain('Volume One');
});
test('missing book remains visible; open is recoverable and remove keeps file wording', async () => {
  const data = fixture([{ ...saved, available: false }]);
  await mount(data);
  await click('Library');
  expect(host.textContent).toContain('Unavailable');
  await click('Open book');
  expect(host.textContent).toContain('Restore the original file');
  expect(data.books()).toHaveLength(1);
  expect(host.textContent).toContain(
    'Removing an entry keeps the original file',
  );
  await click('Remove from Library');
  expect(data.removed).toEqual([saved.id]);
});
test('database failure is surfaced and Library refresh can recover', async () => {
  const data = fixture([saved]);
  const list = data.library.list;
  data.library.list = async () => {
    throw {
      code: 'persistence_failed',
      message: 'Library unavailable; try again.',
    };
  };
  await mount(data);
  await click('Library');
  expect(host.textContent).toContain('Library unavailable; try again.');
  data.library.list = list;
  await click('Refresh Library');
  expect(host.textContent).toContain('Volume One');
});
test('library DTOs validate persistent fields and discard native reference extras', () => {
  expect(parseBooks([{ ...saved, path: '/private/source' }])).toEqual([saved]);
  for (const value of [
    [{ ...saved, id: 'path' }],
    [{ ...saved, pageCount: 0 }],
    [{ ...saved, lastPageIndex: 3, progressPageCount: 3, lastReadAt: 5 }],
    [{ ...saved, status: 'unknown' }],
    [saved, saved],
  ])
    expect(() => parseBooks(value)).toThrow();
});
