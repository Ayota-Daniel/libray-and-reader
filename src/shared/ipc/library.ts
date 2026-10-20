import { desktopInvoke, invalidResponse } from './errors';
import type { LibraryBook } from '../../features/library/model';

// This module owns the wire format and command name. Screens never invoke directly.
export async function listBooks(): Promise<LibraryBook[]> {
  const result: unknown = await desktopInvoke('list_books');
  if (
    !Array.isArray(result) ||
    !result.every(
      (book: unknown) =>
        typeof book === 'object' &&
        book !== null &&
        'id' in book &&
        typeof book.id === 'string' &&
        'title' in book &&
        typeof book.title === 'string',
    )
  ) {
    return invalidResponse();
  }
  return result as LibraryBook[];
}
