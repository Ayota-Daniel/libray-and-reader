import { useState } from 'react';
import type { CSSProperties } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { LibraryBook } from './model';
import { presentBook } from './presentation';

function coverUrl(id: string) {
  try {
    return convertFileSrc(id, 'cover');
  } catch {
    return `cover://localhost/${id}`;
  }
}

export function BookVisual({ book }: { book: LibraryBook }) {
  const [failed, setFailed] = useState(false);
  const presentation = presentBook(book);
  return (
    <div
      className={`book-visual${book.available ? '' : ' is-unavailable'}`}
      style={{ '--book-tone': presentation.tone } as CSSProperties}
    >
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
          aria-valuenow={presentation.progressPercent ?? 0}
        >
          <span style={{ width: `${presentation.progressPercent ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}
