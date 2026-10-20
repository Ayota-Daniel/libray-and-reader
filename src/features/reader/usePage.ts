import { useEffect, useMemo, useState } from 'react';
import type { ReaderController } from './controller';
import type { PageResource, ReaderFailure } from './model';
import { failure } from '../../shared/ipc/errors';

export type PageState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; resource: PageResource }
  | { status: 'error'; error: ReaderFailure };
export function usePage(
  controller: ReaderController,
  sessionId: string | undefined,
  pageId: string | undefined,
): PageState {
  const key = sessionId && pageId ? `${sessionId}:${pageId}` : '';
  const request = useMemo(() => ({ key }), [key]);
  const [result, setResult] = useState<{
    request: typeof request;
    state: PageState;
  } | null>(null);
  useEffect(() => {
    if (!sessionId || !pageId) return;
    const abort = new AbortController();
    let resource: PageResource | undefined;
    void controller.api
      .loadPage(sessionId, pageId, controller.nextRevision(), abort.signal)
      .then(
        (page) => {
          if (abort.signal.aborted) {
            page.dispose();
            return;
          }
          resource = page;
          setResult({ request, state: { status: 'ready', resource: page } });
        },
        (error) => {
          if (!abort.signal.aborted)
            setResult({
              request,
              state: { status: 'error', error: failure(error) },
            });
        },
      );
    return () => {
      abort.abort();
      resource?.dispose();
      void controller.api
        .releasePage(sessionId, controller.nextRevision())
        .catch(() => {
          /* Closed/replaced sessions are already invalidated natively. */
        });
    };
  }, [controller, request, sessionId, pageId]);
  if (!key) return { status: 'empty' };
  // Never label an old ready image with the new page number, even before effects run.
  return result?.request === request ? result.state : { status: 'loading' };
}
