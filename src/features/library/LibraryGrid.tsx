import type { LibraryBook } from './model';
import { EmptyState } from '../../shared/ui/EmptyState';
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
  return (
    <article className="book-card">
      <div className="cover-placeholder" aria-hidden="true">
        CBZ
      </div>
      <h2>{book.title}</h2>
      <p>
        {book.status === 'completed'
          ? 'Completed'
          : book.status === 'reading'
            ? 'Reading'
            : 'Unread'}{' '}
        ·{' '}
        {book.lastPageIndex === null
          ? `${book.pageCount} pages`
          : `Page ${Math.min(book.lastPageIndex + 1, book.pageCount)} / ${book.pageCount}`}
      </p>
      {!book.available && (
        <p>Unavailable — restore the original file, then retry.</p>
      )}
      <button disabled={disabled} onClick={open}>
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
