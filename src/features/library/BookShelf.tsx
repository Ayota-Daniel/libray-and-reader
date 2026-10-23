import type { CSSProperties } from 'react';
import { BookCard } from './LibraryGrid';
import type { LibraryBook } from './model';
import { presentBook } from './presentation';
import './shelf.css';

export function BookShelf({
  books,
  selectedId,
  select,
  open,
  remove,
  disabled,
}: {
  books: readonly LibraryBook[];
  selectedId: string | null;
  select: (id: string | null) => void;
  open: (id: string) => void;
  remove: (id: string) => void;
  disabled: boolean;
}) {
  const selected = books.find((book) => book.id === selectedId);
  if (!books.length) {
    return (
      <div className="bookshelf-empty">
        <div className="shelf-plank" aria-hidden="true" />
        <p>Your shelves are waiting for books.</p>
        <p>Add Books to keep local CBZs in your Library.</p>
      </div>
    );
  }
  return (
    <div className="bookshelf-scene">
      <div className="bookshelf-wall">
        <ul className="bookshelf-grid" aria-label="Bookshelf">
          {books.map((book) => {
            const view = presentBook(book);
            const style = {
              '--spine-width': `${view.thicknessPx}px`,
              '--book-height': `${view.heightPx}px`,
              '--book-tone': view.tone,
            } as CSSProperties;
            return (
              <li className="bookshelf-slot" key={book.id}>
                <button
                  className="shelf-book"
                  type="button"
                  style={style}
                  aria-label={`Select ${view.accessibleLabel}`}
                  aria-pressed={selectedId === book.id}
                  aria-describedby={
                    book.status === 'completed'
                      ? `shelf-status-${book.id}`
                      : undefined
                  }
                  onClick={() =>
                    select(selectedId === book.id ? null : book.id)
                  }
                >
                  <span className="shelf-volume">
                    <span className="shelf-spine-title">{book.title}</span>
                  </span>
                  {book.status === 'completed' && (
                    <span
                      className="shelf-complete"
                      id={`shelf-status-${book.id}`}
                      aria-label="Completed"
                    >
                      ✓
                    </span>
                  )}
                  {!book.available && (
                    <span
                      className="shelf-unavailable"
                      aria-label="Unavailable"
                    >
                      !
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {selected && (
        <section
          className="shelf-details"
          aria-label={`Selected book: ${selected.title}`}
        >
          <BookCard
            book={selected}
            open={() => open(selected.id)}
            remove={() => remove(selected.id)}
            disabled={disabled}
          />
          <button
            type="button"
            className="shelf-deselect"
            onClick={() => select(null)}
          >
            Close details
          </button>
        </section>
      )}
    </div>
  );
}
