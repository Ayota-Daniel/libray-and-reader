import { useState } from 'react';
import { EmptyState } from '../shared/ui/EmptyState';
import { useLibrary } from '../features/library/useLibrary';
import { BookCard } from '../features/library/LibraryGrid';
import type { LibraryApi } from '../features/library/model';
import { failure } from '../shared/ipc/errors';
export function HomeScreen({
  api,
  open,
  beforeRefresh,
}: {
  api: LibraryApi;
  open: (id: string) => Promise<void>;
  beforeRefresh: () => Promise<void>;
}) {
  const { state } = useLibrary(api, beforeRefresh);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const book =
    state.status === 'ready'
      ? [...state.books]
          .filter((b) => b.lastOpenedAt !== null)
          .sort(
            (a, b) =>
              (b.lastReadAt ?? b.lastOpenedAt ?? 0) -
                (a.lastReadAt ?? a.lastOpenedAt ?? 0) ||
              a.id.localeCompare(b.id),
          )[0]
      : undefined;
  return (
    <>
      <header>
        <p className="eyebrow">A quiet place to read</p>
        <h1>Home</h1>
        <p>Pick up where you left off.</p>
      </header>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {error && <p role="alert">{error}</p>}
      {state.status === 'loading' ? (
        <p role="status">Loading library…</p>
      ) : book ? (
        <section aria-label="Continue Reading">
          <h2>Continue Reading</h2>
          <BookCard
            book={book}
            disabled={busy}
            open={() => {
              setBusy(true);
              void open(book.id)
                .catch((e) => setError(failure(e).message))
                .finally(() => setBusy(false));
            }}
          />
        </section>
      ) : (
        <EmptyState title="Your next chapter starts here">
          Add Books in Library to keep your books and reading progress.
        </EmptyState>
      )}
    </>
  );
}
