import { useCallback, useEffect, useRef, useState } from 'react';
import { failure } from '../../shared/ipc/errors';
import { libraryApi } from '../../shared/ipc/library';
import type { LibraryApi, LibraryBook } from './model';
type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; books: LibraryBook[] }
  | { status: 'error'; message: string };
const noRefresh = async () => {};
export function useLibrary(
  api: LibraryApi = libraryApi,
  beforeRefresh: () => Promise<void> = noRefresh,
) {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  const lifecycle = useRef({ revision: 0 });
  const refresh = useCallback(async () => {
    const current = ++lifecycle.current.revision;
    try {
      await beforeRefresh();
      const books = await api.list();
      if (current === lifecycle.current.revision)
        setState({ status: 'ready', books });
    } catch (error) {
      if (current === lifecycle.current.revision)
        setState({ status: 'error', message: failure(error).message });
    }
  }, [api, beforeRefresh]);
  useEffect(() => {
    const state = lifecycle.current;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return refresh();
    });
    return () => {
      active = false;
      ++state.revision;
    };
  }, [refresh]);
  return { state, refresh };
}
