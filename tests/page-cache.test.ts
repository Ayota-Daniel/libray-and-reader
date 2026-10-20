import { expect, test } from 'bun:test';
import {
  PageCache,
  CACHE_BYTES,
  CACHE_LIMIT,
} from '../src/features/reader/pageCache';
import { ReaderController } from '../src/features/reader/controller';
import type {
  PageResource,
  ReadingSession,
} from '../src/features/reader/model';
import {
  book,
  deferred,
  fakeApi,
  replacement,
  resource,
} from './reader-fixtures';

const volume: ReadingSession = {
  ...book,
  pages: Array.from({ length: 8 }, (_, i) => ({
    id: String(i).padStart(32, '0'),
  })),
};
function rig() {
  const { api } = fakeApi();
  const calls: {
    index: number;
    session: string;
    signal: AbortSignal;
    pending: ReturnType<typeof deferred<PageResource>>;
  }[] = [];
  api.loadPage = (session, page, _revision, signal) => {
    const pending = deferred<PageResource>();
    calls.push({
      index: volume.pages.findIndex((p) => p.id === page),
      session,
      signal,
      pending,
    });
    return pending.promise;
  };
  let revision = 0;
  const cache = new PageCache(api, () => ++revision);
  async function finish(at: number, page = resource(`blob:${at}`)) {
    const call = calls[at]!;
    call.pending.resolve(page);
    await call.pending.promise;
    await Promise.resolve(); // cache finalizer schedules the next request
    return page;
  }
  async function fail(at: number) {
    const call = calls[at]!;
    call.pending.reject({ code: 'corrupt_page', message: 'Damaged neighbor' });
    await call.pending.promise.catch(() => {});
    await Promise.resolve();
  }
  return { api, cache, calls, finish, fail };
}

test('active first, then N+1/N-1; cached navigation and reversal reuse the same resources', async () => {
  const { cache, calls, finish } = rig();
  cache.select(volume, 2);
  expect(calls.map((c) => c.index)).toEqual([2]);
  const current = await finish(0);
  expect(calls.map((c) => c.index)).toEqual([2, 3]);
  const next = await finish(1);
  const previous = await finish(2);
  expect(calls.map((c) => c.index)).toEqual([2, 3, 1]);
  cache.select(volume, 3);
  expect(cache.peek(volume.sessionId, volume.pages[3]!.id)).toEqual({
    status: 'ready',
    resource: next,
  });
  expect(calls.map((c) => c.index)).toEqual([2, 3, 1, 4]);
  expect(previous.disposed).toBe(true);
  expect(current.disposed).toBe(false);
  cache.select(volume, 2);
  expect(cache.peek(volume.sessionId, volume.pages[2]!.id)).toEqual({
    status: 'ready',
    resource: current,
  });
  expect(calls.filter((c) => c.index === 2)).toHaveLength(1);
  expect(calls[3]!.signal.aborted).toBe(true);
  const stale = await finish(3);
  expect(stale.disposed).toBe(true);
  expect(cache.peek(volume.sessionId, volume.pages[2]!.id)).toEqual({
    status: 'ready',
    resource: current,
  });
  cache.dispose();
  expect(current.disposed).toBe(true);
  expect(next.disposed).toBe(true);
  await finish(4);
});

test('rapid forward/backward navigation cancels obsolete work with one acquisition and final identity wins', async () => {
  const { cache, calls, finish } = rig();
  cache.select(volume, 0);
  const first = await finish(0);
  for (const index of [1, 2, 3, 2, 1]) cache.select(volume, index);
  expect(calls).toHaveLength(2); // cancelled worker must settle before any further work
  expect(calls[1]!.signal.aborted).toBe(true);
  const late = await finish(1);
  expect(late.disposed).toBe(true);
  expect(calls[2]!.index).toBe(1);
  const final = await finish(2);
  expect(cache.peek(volume.sessionId, volume.pages[1]!.id)).toEqual({
    status: 'ready',
    resource: final,
  });
  expect(first.disposed).toBe(true);
  expect(cache.inspect().inFlight).toBe(1);
  cache.dispose();
  await finish(3);
});

test('foreground preempts a still-useful speculative page but can promote its own in-flight target', async () => {
  const { cache, calls, finish } = rig();
  cache.select(volume, 2);
  await finish(0); // preloading 3
  cache.select(volume, 3);
  expect(calls[1]!.signal.aborted).toBe(false);
  expect(calls).toHaveLength(2);
  await finish(1); // preloading 4
  cache.select(volume, 1); // 4 is obsolete and 1 is not ready
  expect(calls[2]!.signal.aborted).toBe(true);
  await finish(2);
  expect(calls[3]!.index).toBe(1);
  cache.dispose();
  await finish(3);
});

test('count and decoded-estimate bounds hold; large active pages display while neighbors degrade', async () => {
  const { cache, calls, finish } = rig();
  cache.select(volume, 2);
  const large = () => ({ ...resource(), width: 3000, height: 4000 });
  const active = await finish(0, large());
  const right = await finish(1, large());
  const left = await finish(2, large());
  expect(cache.inspect().indices.length).toBeLessThanOrEqual(CACHE_LIMIT);
  expect(cache.inspect().bytes).toBeLessThanOrEqual(CACHE_BYTES);
  expect(cache.inspect().ready).toEqual([2]);
  expect(active.disposed).toBe(false);
  expect(right.disposed).toBe(true);
  expect(left.disposed).toBe(true);
  expect(calls).toHaveLength(3); // no speculative retry loop for budget-skipped pages
  cache.select(volume, 3);
  expect(calls[3]!.index).toBe(3);
  const newActive = await finish(3, large());
  expect(cache.inspect().ready).toEqual([3]);
  expect(active.disposed).toBe(true);
  expect(newActive.disposed).toBe(false);
  expect(cache.inspect().bytes).toBeLessThanOrEqual(CACHE_BYTES);
  cache.dispose();
  await finish(4);
});

test('working set never grows during a long traversal; evictions dispose and endpoints do not wrap', async () => {
  const { cache, calls, finish } = rig();
  const resources: ReturnType<typeof resource>[] = [];
  let completed = 0;
  for (let index = 0; index < volume.pages.length; index++) {
    cache.select(volume, index);
    while (completed < calls.length) resources.push(await finish(completed++));
    expect(cache.inspect().indices.length).toBeLessThanOrEqual(3);
    expect(resources.filter((r) => !r.disposed).length).toBeLessThanOrEqual(3);
    expect(cache.inspect().ready).toContain(index);
  }
  expect(
    calls.every((c) => c.index >= 0 && c.index < volume.pages.length),
  ).toBe(true);
  expect(calls).toHaveLength(volume.pages.length);
  cache.dispose();
  expect(resources.every((r) => r.disposed)).toBe(true);
});

test('preload failure stays local, explicit navigation retries it, and stale errors are ignored', async () => {
  const { cache, calls, finish, fail } = rig();
  cache.select(volume, 0);
  const active = await finish(0);
  await fail(1);
  expect(cache.peek(volume.sessionId, volume.pages[0]!.id)).toEqual({
    status: 'ready',
    resource: active,
  });
  cache.select(volume, 1);
  expect(calls[2]!.index).toBe(1);
  await fail(2);
  expect(cache.peek(volume.sessionId, volume.pages[1]!.id).status).toBe(
    'error',
  );
  cache.select(volume, 0); // cancels speculative 2
  await fail(3);
  expect(cache.peek(volume.sessionId, volume.pages[0]!.id)).toEqual({
    status: 'ready',
    resource: active,
  });
  cache.dispose();
});

test('screen detach clears all pages and late work; StrictMode reattach preserves one acquisition', async () => {
  const { cache, calls, finish } = rig();
  const lease = cache.attach();
  cache.select(volume, 0);
  cache.detach(lease);
  const second = cache.attach();
  cache.select(volume, 0);
  await Promise.resolve();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.signal.aborted).toBe(false);
  const active = await finish(0);
  cache.detach(second);
  await Promise.resolve();
  expect(active.disposed).toBe(true);
  expect(calls[1]!.signal.aborted).toBe(true);
  const late = await finish(1);
  expect(late.disposed).toBe(true);
  expect(cache.inspect().indices).toHaveLength(0);
  cache.attach();
  cache.select(volume, 0);
  expect(calls[2]!.index).toBe(0);
  cache.dispose();
  await finish(2);
});

test('controller cancel/failure preserves cache; successful replacement and close dispose everything', async () => {
  const { api, cache: unused, calls, finish } = rig();
  unused.dispose();
  api.openSelected = async () => volume;
  const controller = new ReaderController(api);
  await controller.open();
  controller.pages.select(controller.getSnapshot().book, 0);
  const active = await finish(0);
  const neighbor = await finish(1);
  api.openSelected = async () => null;
  await controller.open();
  expect(active.disposed).toBe(false);
  expect(neighbor.disposed).toBe(false);
  api.openSelected = async () => {
    throw new Error('bad archive');
  };
  await controller.open();
  expect(active.disposed).toBe(false);
  expect(calls).toHaveLength(2);
  api.openSelected = async () => replacement;
  await controller.open();
  expect(active.disposed).toBe(true);
  expect(neighbor.disposed).toBe(true);
  controller.pages.select(controller.getSnapshot().book, 0);
  const next = await finish(2);
  await controller.close();
  expect(next.disposed).toBe(true);
  expect(controller.pages.inspect().indices).toHaveLength(0);
  controller.dispose();
});

test('replacement while a preload is pending cannot publish old data into the new session', async () => {
  const { cache, calls, finish } = rig();
  cache.select(volume, 0);
  const active = await finish(0);
  cache.select(replacement, 0);
  expect(active.disposed).toBe(true);
  expect(calls[1]!.signal.aborted).toBe(true);
  const late = await finish(1);
  expect(late.disposed).toBe(true);
  expect(calls[2]!.session).toBe(replacement.sessionId);
  const current = await finish(2);
  expect(cache.peek(replacement.sessionId, replacement.pages[0]!.id)).toEqual({
    status: 'ready',
    resource: current,
  });
  cache.dispose();
});
