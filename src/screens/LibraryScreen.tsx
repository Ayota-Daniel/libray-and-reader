import { useState } from 'react';
import { LibraryGrid } from '../features/library/LibraryGrid';
import { useLibrary } from '../features/library/useLibrary';
import type { LibraryApi, ImportResult } from '../features/library/model';
import { failure } from '../shared/ipc/errors';
export function LibraryScreen({
  api,
  open,
  beforeRefresh,
}: {
  api: LibraryApi;
  open: (id: string) => Promise<void>;
  beforeRefresh: () => Promise<void>;
}) {
  const { state, refresh } = useLibrary(api, beforeRefresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(failure(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header>
        <p className="eyebrow">Your complete collection</p>
        <h1>Library</h1>
        <p>
          Local books, saved progress. Removing an entry keeps the original
          file.
        </p>
        <button
          disabled={busy}
          onClick={() => void act(async () => setResults(await api.add()))}
        >
          Add Books
        </button>{' '}
        <button disabled={busy} onClick={() => void refresh()}>
          Refresh Library
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {results.length > 0 && (
        <div role="status">
          <p>
            {results.filter((r) => r.outcome === 'imported').length} imported ·{' '}
            {results.filter((r) => r.outcome === 'duplicate').length} already in
            library · {results.filter((r) => r.outcome === 'failed').length}{' '}
            failed
          </p>
          <ul>
            {results.map((r, i) => (
              <li key={i}>
                {r.title}:{' '}
                {r.error?.message ??
                  (r.outcome === 'duplicate'
                    ? 'Already in library'
                    : 'Imported')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.status === 'loading' && <p role="status">Loading library…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <p role="status">
            Desktop core connected · {state.books.length} books
          </p>
          <LibraryGrid
            books={state.books}
            disabled={busy}
            open={(id) => void act(() => open(id))}
            remove={(id) => void act(() => api.remove(id))}
          />
        </>
      )}
    </>
  );
}
