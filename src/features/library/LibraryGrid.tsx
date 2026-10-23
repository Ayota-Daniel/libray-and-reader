import type { LibraryBook } from './model';
import { EmptyState } from '../../shared/ui/EmptyState';
import { BookVisual } from './BookVisual';
import { presentBook } from './presentation';
export function BookCard({
  book,
  open,
  remove,
  disabled = false,
}: {
  book: LibraryBook;
  open: () => void;
  remove?: () => void;
  disabled?: boolean;
}) {
  const presentation = presentBook(book);
  return (
    <article className="book-card" data-status={book.status}>
      <BookVisual book={book} />
      <h2>{book.title}</h2>
      <p className="book-meta">
        {presentation.statusLabel} · {presentation.pageLabel}
      </p>
      {!book.available && (
        <p>Unavailable — restore the original file, then retry.</p>
      )}
      <button className="book-open" disabled={disabled} onClick={open}>
        {book.lastOpenedAt === null ? 'Open book' : 'Resume reading'}
      </button>
      {remove && (
        <button disabled={disabled} onClick={remove}>
          Remove from Library
        </button>
      )}
    </article>
  );
}
export function LibraryGrid({
  books,
  open,
  remove,
  disabled,
}: {
  books: readonly LibraryBook[];
  open: (id: string) => void;
  remove: (id: string) => void;
  disabled: boolean;
}) {
  if (!books.length)
    return (
      <EmptyState title="Your library is empty">
        Add Books to keep local CBZs here. Open CBZ in Reader remains a
        temporary read.
      </EmptyState>
    );
  return (
    <ul className="library-grid">
      {books.map((book) => (
        <li key={book.id}>
          <BookCard
            book={book}
            open={() => open(book.id)}
            remove={() => remove(book.id)}
            disabled={disabled}
          />
        </li>
      ))}
    </ul>
  );
}
