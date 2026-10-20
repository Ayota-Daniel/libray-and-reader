import { useEffect, useState } from 'react';
import { listBooks } from '../../shared/ipc/library';
import type { LibraryBook } from './model';

type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; books: LibraryBook[] }
  | { status: 'error'; message: string };
export function useLibrary(): LibraryState {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void listBooks().then(
      (books) => {
        if (active) setState({ status: 'ready', books });
      },
      () => {
        if (active)
          setState({
            status: 'error',
            message:
              'Could not reach the desktop core. Run this application with bun run dev.',
          });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
