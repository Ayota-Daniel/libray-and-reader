import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { LibraryBook } from './model';

function coverUrl(id: string) {
  try {
    return convertFileSrc(id, 'cover');
  } catch {
    return `cover://localhost/${id}`;
  }
}

export function BookVisual({ book }: { book: LibraryBook }) {
  const [failed, setFailed] = useState(false);
  const progress =
    book.lastPageIndex === null
      ? 0
      : Math.min(
          100,
          Math.round(
            ((book.lastPageIndex + 1) /
              (book.progressPageCount ?? book.pageCount)) *
              100,
          ),
        );
  return (
    <div className={`book-visual${book.available ? '' : ' is-unavailable'}`}>
      {!failed ? (
        <img
          src={coverUrl(book.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="book-fallback" aria-hidden="true">
          <span className="book-fallback-spine" />
          <span>{book.title}</span>
          <small>CBZ</small>
        </div>
      )}
      {failed && book.available && (
        <button className="cover-retry" onClick={() => setFailed(false)}>
          Retry cover
        </button>
      )}
      {book.status === 'completed' && (
        <span className="book-status" aria-label="Completed">
          ✓
        </span>
      )}
      {!book.available && <span className="book-unavailable">Unavailable</span>}
      {book.lastPageIndex !== null && (
        <div
          className="book-progress"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
