import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { ReaderController } from './controller';
export type { PageState } from './pageCache';

export function usePage(
  controller: ReaderController,
  sessionId: string | undefined,
  pageId: string | undefined,
) {
  const cache = controller.pages;
  useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  useEffect(() => {
    const lease = cache.attach();
    return () => cache.detach(lease);
  }, [cache]);
  useLayoutEffect(() => {
    const { book, pageIndex } = controller.getSnapshot();
    cache.select(book, pageIndex);
  }, [cache, controller, sessionId, pageId]);
  // Read the requested identity, never the previous selection during an effect gap.
  return cache.peek(sessionId, pageId);
}
