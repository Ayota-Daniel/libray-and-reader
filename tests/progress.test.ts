import { expect, test } from 'bun:test';
import { ProgressQueue } from '../src/features/reader/progress';
import { ReaderController } from '../src/features/reader/controller';
import { book, deferred, fakeApi } from './reader-fixtures';

test('progress queue coalesces turns to one in-flight plus latest and flush waits for durability', async () => {
  const { api } = fakeApi();
  const first = deferred<void>();
  const second = deferred<void>();
  const calls: number[] = [];
  let flushes = 0;
  api.recordProgress = async (_id, index) => {
    calls.push(index);
    await (calls.length === 1 ? first.promise : second.promise);
  };
  api.flushProgress = async () => {
    flushes++;
  };
  const queue = new ProgressQueue(api, () => {});
  queue.record(book.sessionId, 1);
  queue.record(book.sessionId, 2);
  queue.record(book.sessionId, 3);
  const flush = queue.flush();
  expect(calls).toEqual([1]);
  expect(flushes).toBe(0);
  first.resolve();
  await first.promise;
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual([1, 3]);
  second.resolve();
  await flush;
  expect(flushes).toBe(1);
});
test('failed progress prevents close, reports error and can be retried', async () => {
  const { api, closed } = fakeApi();
  api.openLibrary = async () => ({ ...book, libraryBookId: '9'.repeat(32) });
  let failing = true;
  api.recordProgress = async () => {
    if (failing)
      throw { code: 'persistence_failed', message: 'Cannot save progress' };
  };
  api.flushProgress = async () => {
    if (failing)
      throw { code: 'persistence_failed', message: 'Cannot save progress' };
  };
  const controller = new ReaderController(api);
  await controller.open('9'.repeat(32));
  controller.step(1);
  await controller.close();
  expect(closed).toHaveLength(0);
  expect(controller.getSnapshot().error?.code).toBe('persistence_failed');
  failing = false;
  await controller.close();
  expect(closed).toEqual([book.sessionId]);
  controller.dispose();
});
test('temporary reading sends no progress and library opening resumes without marking completion', async () => {
  const { api } = fakeApi();
  let writes = 0;
  api.recordProgress = async () => {
    writes++;
  };
  api.flushProgress = async () => {};
  const controller = new ReaderController(api);
  await controller.open();
  controller.step(1);
  await controller.progress.flush();
  expect(writes).toBe(0);
  api.openLibrary = async () => ({
    ...book,
    libraryBookId: '9'.repeat(32),
    initialPageIndex: 1,
  });
  await controller.open('9'.repeat(32));
  expect(controller.getSnapshot().pageIndex).toBe(1);
  expect(writes).toBe(0);
  controller.step(-1);
  await controller.progress.flush();
  expect(writes).toBe(1);
  controller.dispose();
});
