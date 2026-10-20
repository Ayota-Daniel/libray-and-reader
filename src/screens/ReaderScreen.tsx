import { useEffect } from 'react';
import type { ReaderModel } from '../features/reader/useReader';
import { usePage } from '../features/reader/usePage';
import { navigationDelta } from '../features/reader/keyboard';
import { ReaderPresentation } from '../features/reader/ReaderPresentation';
import { ReaderNavigation } from '../features/reader/ReaderNavigation';
export function ReaderScreen({ reader }: { reader: ReaderModel }) {
  const { controller, snapshot } = reader;
  const { book, pageIndex, opening, closing, error } = snapshot;
  const page = usePage(controller, book?.sessionId, book?.pages[pageIndex]?.id);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      const delta = navigationDelta(
        event,
        event.target,
        !!book && !closing,
        reader.direction,
      );
      if (delta !== null) {
        event.preventDefault();
        controller.step(delta);
      }
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [book, closing, controller, reader.direction]);
  return (
    <div className="reader-screen">
      <header>
        <p className="eyebrow">Room for the story</p>
        <h1>Reader</h1>
        <h2 className="book-title">{book?.title ?? 'Local CBZ reader'}</h2>
        <div className="reader-actions">
          <button
            onClick={() => void controller.open()}
            disabled={opening || closing}
          >
            Open CBZ
          </button>
          <button
            onClick={() => void controller.close()}
            disabled={(!book && !opening) || closing}
          >
            Close book
          </button>
        </div>
        {opening && (
          <p role="status">
            Choose a CBZ. Its pages will be indexed before replacing the current
            book.
          </p>
        )}
        {closing && <p role="status">Closing book…</p>}
        {error && <p role="alert">{error.message}</p>}
      </header>
      <ReaderPresentation
        key={`${book?.sessionId}:${pageIndex}`}
        reader={reader}
        page={page}
        number={pageIndex + 1}
      />
      <ReaderNavigation
        direction={reader.direction}
        state={{ pageCount: book?.pages.length ?? 0, pageIndex }}
        previous={() => controller.step(-1)}
        next={() => controller.step(1)}
      />
    </div>
  );
}
