import { BookShelf } from './BookShelf';
import { LibraryGrid } from './LibraryGrid';
import type { LibraryBook } from './model';

export type LibraryView = 'grid' | 'shelf';

export function LibraryRenderer({
  view,
  books,
  selectedId,
  select,
  open,
  remove,
  disabled,
}: {
  view: LibraryView;
  books: readonly LibraryBook[];
  selectedId: string | null;
  select: (id: string | null) => void;
  open: (id: string) => void;
  remove: (id: string) => void;
  disabled: boolean;
}) {
  if (view === 'shelf') {
    return (
      <BookShelf
        books={books}
        selectedId={selectedId}
        select={select}
        open={open}
        remove={remove}
        disabled={disabled}
      />
    );
  }
  return (
    <LibraryGrid
      books={books}
      open={open}
      remove={remove}
      disabled={disabled}
    />
  );
}
