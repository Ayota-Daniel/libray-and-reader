import { useEffect, useState } from 'react';
import { failure } from '../../shared/ipc/errors';
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
      (error: unknown) => {
        if (active)
          setState({
            status: 'error',
            message: failure(error).message,
          });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
