import { LibraryGrid } from '../features/library/LibraryGrid';
import { useLibrary } from '../features/library/useLibrary';
export function LibraryScreen() {
  const library = useLibrary();
  return (
    <>
      <header>
        <p className="eyebrow">Your complete collection</p>
        <h1>Library</h1>
        <p>A home for your books and scans.</p>
      </header>
      {library.status === 'loading' && (
        <p role="status">Connecting to your library…</p>
      )}
      {library.status === 'error' && <p role="alert">{library.message}</p>}
      {library.status === 'ready' && (
        <>
          <p className="connection-status" role="status">
            Desktop core connected · {library.books.length} books
          </p>
          <LibraryGrid books={library.books} />
        </>
      )}
    </>
  );
}
