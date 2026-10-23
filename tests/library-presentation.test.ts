import { expect, test } from 'bun:test';
import type { LibraryBook } from '../src/features/library/model';
import {
  heightForBookId,
  presentBook,
  thicknessForPages,
} from '../src/features/library/presentation';

const book: LibraryBook = {
  id: 'a'.repeat(32),
  sourceKind: 'local_cbz',
  title: 'Fixture volume',
  pageCount: 300,
  addedAt: 1,
  lastOpenedAt: null,
  lastPageIndex: null,
  progressPageCount: null,
  lastReadAt: null,
  status: 'unread',
  available: true,
};

test('thickness is a bounded deterministic visual hint with a sane unknown default', () => {
  expect(thicknessForPages(undefined)).toBe(14);
  expect(thicknessForPages(null)).toBe(14);
  expect(thicknessForPages(0)).toBe(14);
  expect(thicknessForPages(20)).toBe(9);
  expect(thicknessForPages(300)).toBe(15);
  expect(thicknessForPages(10000)).toBe(22);
  expect(
    [20, 80, 180, 350, 600, 10000]
      .map(thicknessForPages)
      .every((n) => n >= 9 && n <= 22),
  ).toBe(true);
});

test('height and fallback tone are stable per opaque ID and presentation never mutates domain data', () => {
  const before = structuredClone(book);
  const first = presentBook(book);
  expect(presentBook(book)).toEqual(first);
  expect(heightForBookId(book.id)).toBe(heightForBookId(book.id));
  expect(first.heightPx).toBeGreaterThanOrEqual(217);
  expect(first.heightPx).toBeLessThanOrEqual(223);
  expect(book).toEqual(before);
});
