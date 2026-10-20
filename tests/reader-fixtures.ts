import type {
  PageResource,
  ReaderApi,
  ReadingSession,
} from '../src/features/reader/model';
export const book: ReadingSession = {
  sessionId: 'a'.repeat(32),
  title: 'Test book',
  pages: [{ id: '1'.repeat(32) }, { id: '2'.repeat(32) }],
};
export const replacement: ReadingSession = {
  sessionId: 'b'.repeat(32),
  title: 'Replacement',
  pages: [{ id: '3'.repeat(32) }],
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
export function resource(
  url = 'blob:page',
): PageResource & { disposed: boolean } {
  return {
    url,
    width: 1,
    height: 1,
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}
export function fakeApi() {
  const closed: string[] = [];
  const cancelled: string[] = [];
  const released: [string, number][] = [];
  const loaded: { sessionId: string; pageId: string; signal: AbortSignal }[] =
    [];
  const api: ReaderApi = {
    beginOpen: async () => 'e'.repeat(32),
    openSelected: async () => book,
    cancelOpen: async (id) => {
      cancelled.push(id);
    },
    closeBook: async (id) => {
      closed.push(id);
    },
    loadPage: async (sessionId, pageId, _revision, signal) => {
      loaded.push({ sessionId, pageId, signal });
      return resource(`blob:${pageId}`);
    },
    releasePage: async (id, revision) => {
      released.push([id, revision]);
    },
  };
  return { api, closed, cancelled, released, loaded };
}
