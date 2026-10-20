import type { LibraryBook } from './model';
import { EmptyState } from '../../shared/ui/EmptyState';
export function LibraryGrid({ books }: { books: readonly LibraryBook[] }) {
  if (books.length === 0)
    return (
      <EmptyState title="An empty shelf, for now">
        Local content import is planned for the next milestone.
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
