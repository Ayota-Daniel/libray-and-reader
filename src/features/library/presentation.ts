import type { LibraryBook } from './model';

export type LibraryBookPresentation = {
  book: LibraryBook;
  statusLabel: 'Unread' | 'Reading' | 'Completed';
  pageLabel: string;
  progressPercent: number | null;
  thicknessPx: number;
  heightPx: number;
  tone: string;
  accessibleLabel: string;
};

const tones = [
  '#4a405e',
  '#36505b',
  '#5c433b',
  '#45523b',
  '#5b4052',
  '#3f4961',
];

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function thicknessForPages(
  pageCount: number | null | undefined,
): number {
  if (!Number.isSafeInteger(pageCount) || (pageCount ?? 0) < 1) return 14;
  if (pageCount! <= 80) return 9;
  if (pageCount! <= 180) return 12;
  if (pageCount! <= 350) return 15;
  if (pageCount! <= 600) return 19;
  return 22;
}

export function heightForBookId(id: string): number {
  return 220 + (stableHash(id) % 7) - 3;
}

export function presentBook(book: LibraryBook): LibraryBookPresentation {
  const statusLabel =
    book.status === 'completed'
      ? 'Completed'
      : book.status === 'reading'
        ? 'Reading'
        : 'Unread';
  const progressPercent =
    book.lastPageIndex === null
      ? null
      : Math.min(
          100,
          Math.round(
            ((book.lastPageIndex + 1) /
              (book.progressPageCount ?? book.pageCount)) *
              100,
          ),
        );
  const pageLabel =
    book.lastPageIndex === null
      ? `${book.pageCount} pages`
      : `Page ${Math.min(book.lastPageIndex + 1, book.pageCount)} / ${book.progressPageCount ?? book.pageCount}`;
  const hash = stableHash(book.id);
  return {
    book,
    statusLabel,
    pageLabel,
    progressPercent,
    thicknessPx: thicknessForPages(book.pageCount),
    heightPx: heightForBookId(book.id),
    tone: tones[hash % tones.length]!,
    accessibleLabel: `${book.title}, ${statusLabel.toLowerCase()}, ${pageLabel}${book.available ? '' : ', unavailable'}`,
  };
}
