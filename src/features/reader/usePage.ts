import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { ReaderController } from './controller';
export type { PageState } from './pageCache';

export function usePresentation(controller: ReaderController) {
  const cache = controller.pages;
  const version = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const { book, group, mode, coverAlone, planRevision } =
    controller.getSnapshot();
  const identity = group.join(',');
  useEffect(() => {
    const lease = cache.attach();
    return () => cache.detach(lease);
  }, [cache]);
  useLayoutEffect(() => {
    const plan = controller.cachePlan();
    cache.selectPresentation(book, plan.active, plan.neighbors);
  }, [cache, controller, book, identity, mode, coverAlone, planRevision]);
  // Version triggers re-reading only; selection must not publish in a render loop.
  void version;
  return group.map((index) => ({
    index,
    page: cache.peek(book?.sessionId, book?.pages[index]?.id),
  }));
}
