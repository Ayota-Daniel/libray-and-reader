import { expect, test } from 'bun:test';
import { ReaderController } from '../src/features/reader/controller';
import { book, replacement, deferred, fakeApi } from './reader-fixtures';
import type { ReadingSession } from '../src/features/reader/model';

test('open, cancel picker, failed/successful replacement and close', async () => {
  const { api, closed } = fakeApi();
  const controller = new ReaderController(api);
  await controller.open();
  controller.step(1);
  expect(controller.getSnapshot().pageIndex).toBe(1);
  api.openSelected = async () => null;
  await controller.open();
  expect(controller.getSnapshot().book).toEqual(book);
  expect(controller.getSnapshot().pageIndex).toBe(1);
  api.openSelected = async () => {
    throw { code: 'invalid_archive', message: 'Invalid archive' };
  };
  await controller.open();
  expect(controller.getSnapshot().book).toEqual(book);
  expect(controller.getSnapshot().error?.code).toBe('invalid_archive');
  const pending = deferred<ReadingSession | null>();
  api.openSelected = () => pending.promise;
  const opening = controller.open();
  await Promise.resolve();
  expect(controller.getSnapshot().opening).toBe(true);
  expect(controller.getSnapshot().book).toEqual(book);
  pending.resolve(replacement);
  await opening;
  expect(controller.getSnapshot().book).toEqual(replacement);
  expect(controller.getSnapshot().pageIndex).toBe(0);
  await controller.close();
  expect(closed).toEqual([replacement.sessionId]);
  expect(controller.getSnapshot().book).toBeNull();
  api.openSelected = async () => book;
  await controller.open();
  expect(controller.getSnapshot().pageIndex).toBe(0);
  controller.dispose();
});

test('close during an opening cancels and closes a late native success', async () => {
  const { api, closed, cancelled } = fakeApi();
  const pending = deferred<ReadingSession | null>();
  api.openSelected = () => pending.promise;
  const controller = new ReaderController(api);
  const opening = controller.open();
  await Promise.resolve();
  await controller.close();
  pending.resolve(book);
  await opening;
  expect(cancelled).toHaveLength(1);
  expect(closed).toEqual([book.sessionId]);
  expect(controller.getSnapshot().book).toBeNull();
});

test('dispose before beginOpen resolves cancels its late reservation', async () => {
  const { api, cancelled } = fakeApi();
  const pending = deferred<string>();
  api.beginOpen = () => pending.promise;
  const controller = new ReaderController(api);
  const opening = controller.open();
  controller.dispose();
  pending.resolve('f'.repeat(32));
  await opening;
  expect(cancelled).toEqual(['f'.repeat(32)]);
});

test('concurrent open actions are not queued', async () => {
  const { api } = fakeApi();
  let calls = 0;
  const pending = deferred<ReadingSession | null>();
  api.openSelected = () => {
    calls++;
    return pending.promise;
  };
  const controller = new ReaderController(api);
  const first = controller.open();
  await Promise.resolve();
  await controller.open();
  expect(calls).toBe(1);
  pending.resolve(null);
  await first;
  controller.dispose();
});
