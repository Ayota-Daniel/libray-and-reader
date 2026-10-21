import { desktopInvoke, invalidResponse } from './errors';
import { isId } from './reader';
import type {
  LibraryBook,
  LibraryApi,
  ImportResult,
} from '../../features/library/model';
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown) => v === null || integer(v);
const title = (v: unknown) =>
  typeof v === 'string' && v.length > 0 && [...v].length <= 256;
export function parseBooks(value: unknown): LibraryBook[] {
  if (!Array.isArray(value) || value.length > 10000) return invalidResponse();
  const ids = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return invalidResponse();
    const b = item as Record<string, unknown>;
    if (
      !isId(b.id) ||
      ids.has(b.id) ||
      !title(b.title) ||
      b.sourceKind !== 'local_cbz' ||
      !integer(b.pageCount) ||
      b.pageCount < 1 ||
      b.pageCount > 10000 ||
      !integer(b.addedAt) ||
      !nullable(b.lastOpenedAt) ||
      !nullable(b.lastReadAt) ||
      !nullable(b.lastPageIndex) ||
      !nullable(b.progressPageCount) ||
      typeof b.available !== 'boolean' ||
      !['unread', 'reading', 'completed'].includes(String(b.status)) ||
      (b.lastPageIndex === null) !== (b.progressPageCount === null) ||
      (b.lastPageIndex === null) !== (b.lastReadAt === null) ||
      (typeof b.lastPageIndex === 'number' &&
        (typeof b.progressPageCount !== 'number' ||
          b.progressPageCount < 1 ||
          b.progressPageCount > 10000 ||
          b.lastPageIndex >= b.progressPageCount))
    )
      return invalidResponse();
    ids.add(b.id);
  }
  return (value as LibraryBook[]).map((b) => ({
    id: b.id,
    sourceKind: b.sourceKind,
    title: b.title,
    pageCount: b.pageCount,
    addedAt: b.addedAt,
    lastOpenedAt: b.lastOpenedAt,
    lastPageIndex: b.lastPageIndex,
    progressPageCount: b.progressPageCount,
    lastReadAt: b.lastReadAt,
    status: b.status,
    available: b.available,
  }));
}
export const libraryApi: LibraryApi = {
  async list() {
    return parseBooks(await desktopInvoke('list_books'));
  },
  async add() {
    const value: unknown = await desktopInvoke('add_books');
    if (!Array.isArray(value) || value.length > 100) return invalidResponse();
    for (const item of value as unknown[]) {
      if (typeof item !== 'object' || item === null) return invalidResponse();
      const r = item as Record<string, unknown>;
      if (
        !title(r.title) ||
        !['imported', 'duplicate', 'failed'].includes(String(r.outcome)) ||
        (r.outcome === 'failed'
          ? typeof r.error !== 'object' ||
            r.error === null ||
            !('message' in r.error) ||
            typeof r.error.message !== 'string' ||
            !('code' in r.error) ||
            typeof r.error.code !== 'string'
          : r.error !== null)
      )
        return invalidResponse();
    }
    return value as ImportResult[];
  },
  async remove(bookId) {
    if ((await desktopInvoke('remove_book', { bookId })) !== null)
      invalidResponse();
  },
};
export const listBooks = () => libraryApi.list();
