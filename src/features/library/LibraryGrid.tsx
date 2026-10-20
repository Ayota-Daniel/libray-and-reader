import type { LibraryBook } from './model';
import { EmptyState } from '../../shared/ui/EmptyState';
export function LibraryGrid({ books }: { books: readonly LibraryBook[] }) {
  if (books.length === 0)
    return (
      <EmptyState title="An empty shelf, for now">
        No persistent collection yet. Open a CBZ in Reader without importing it.
      </EmptyState>
    );
  return (
    <ul className="library-grid">
      {books.map((book) => (
        <li key={book.id}>{book.title}</li>
      ))}
    </ul>
  );
}
