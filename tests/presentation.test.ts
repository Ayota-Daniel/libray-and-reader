import { expect, test } from 'bun:test';
import {
  planGroups,
  containing,
  visualOrder,
  isWide,
  pageNumber,
  composedSize,
} from '../src/features/reader/presentation';
import { ReaderController } from '../src/features/reader/controller';
import { book, deferred, fakeApi, resource } from './reader-fixtures';
const groups = (count: number, cover = false, wide: number[] = []) =>
  planGroups(count, 'double', cover, new Set(wide));
test('canonical Single and Double groups handle even, odd, isolated cover and endpoints', () => {
  expect(planGroups(3, 'single', true, new Set([1]))).toEqual([[0], [1], [2]]);
  expect(groups(6)).toEqual([
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
  expect(groups(5)).toEqual([[0, 1], [2, 3], [4]]);
  expect(groups(6, true)).toEqual([[0], [1, 2], [3, 4], [5]]);
  expect(groups(5, true)).toEqual([[0], [1, 2], [3, 4]]);
  expect(groups(0)).toEqual([]);
  expect(groups(1, true)).toEqual([[0]]);
});
test('wide pages at start, middle, end and consecutive positions always stand alone', () => {
  expect(groups(5, false, [0])).toEqual([[0], [1, 2], [3, 4]]);
  expect(groups(5, false, [2])).toEqual([[0, 1], [2], [3, 4]]);
  expect(groups(4, false, [3])).toEqual([[0, 1], [2], [3]]);
  expect(groups(6, false, [1, 2, 3])).toEqual([[0], [1], [2], [3], [4, 5]]);
  expect(isWide({ width: 1200, height: 1000 })).toBe(true);
  expect(isWide({ width: 1199, height: 1000 })).toBe(false);
});
test('direction changes placement only and composed geometry preserves intrinsic sizes', () => {
  const group = containing(groups(20), 13);
  expect(group).toEqual([12, 13]);
  expect(visualOrder(group, 'ltr')).toEqual([12, 13]);
  expect(visualOrder(group, 'rtl')).toEqual([13, 12]);
  expect(group).toEqual([12, 13]);
  expect(
    composedSize([
      { width: 600, height: 1000 },
      { width: 500, height: 800 },
    ]),
  ).toEqual({ width: 1108, height: 1000 });
});
test('direct navigation validates integers, range, blanks, signs and non-numbers', () => {
  for (const input of ['', ' ', 'x', '0', '-1', '11', '2.5', 'Infinity', '1e1'])
    expect(pageNumber(input, 10)).toBeNull();
  expect(pageNumber('1', 10)).toBe(0);
  expect(pageNumber(' 10 ', 10)).toBe(9);
});
test('mode/cover switches, jumps and resume preserve canonical containment without reopening', async () => {
  const { api } = fakeApi();
  let opens = 0;
  api.openLibrary = async () => {
    opens++;
    return {
      ...book,
      libraryBookId: '9'.repeat(32),
      initialPageIndex: 3,
      pages: Array.from({ length: 7 }, (_, i) => ({ id: String(i) })),
    };
  };
  const controller = new ReaderController(api);
  controller.setPresentation('double');
  await controller.open('9'.repeat(32));
  expect(controller.getSnapshot().group).toEqual([2, 3]);
  controller.setPresentation('single');
  expect(controller.getSnapshot().pageIndex).toBe(2);
  controller.jump('6');
  controller.setPresentation('double');
  expect(controller.getSnapshot().group).toEqual([4, 5]);
  controller.setPresentation('double', true);
  expect(controller.getSnapshot().group).toEqual([5, 6]);
  controller.step(-1);
  expect(controller.getSnapshot().group).toEqual([3, 4]);
  controller.step(1);
  expect(controller.getSnapshot().group).toEqual([5, 6]);
  controller.jump('1');
  expect(controller.getSnapshot().group).toEqual([0]);
  expect(controller.jump('100')).toBe(false);
  expect(opens).toBe(1);
  controller.dispose();
});
test('final spread stores lowest canonical anchor and endpoint; backwards clears completion', async () => {
  const { api } = fakeApi();
  const writes: [number, number | undefined][] = [];
  api.openLibrary = async () => ({
    ...book,
    libraryBookId: '9'.repeat(32),
    pages: Array.from({ length: 4 }, (_, i) => ({ id: String(i) })),
  });
  api.recordProgress = async (_id, index, _rev, last) => {
    writes.push([index, last]);
  };
  const controller = new ReaderController(api);
  await controller.open('9'.repeat(32));
  controller.setPresentation('double');
  controller.step(1);
  await controller.progress.flush();
  expect(writes.at(-1)).toEqual([2, 3]);
  controller.step(-1);
  await controller.progress.flush();
  expect(writes.at(-1)).toEqual([0, 1]);
  controller.dispose();
});
test('one-page completion requires presentation, ignores stale sessions and is not caused by acquisition', async () => {
  const { api } = fakeApi();
  let writes = 0;
  api.openLibrary = async () => ({
    ...book,
    libraryBookId: '9'.repeat(32),
    pages: [book.pages[0]!],
  });
  api.recordProgress = async () => {
    writes++;
  };
  const controller = new ReaderController(api);
  await controller.open('9'.repeat(32));
  controller.pages.select(controller.getSnapshot().book, 0);
  await Promise.resolve();
  expect(writes).toBe(0);
  controller.presentedPage('old', 0);
  expect(writes).toBe(0);
  controller.presentedPage(book.sessionId, 0);
  await controller.progress.flush();
  expect(writes).toBe(1);
  controller.presentedPage(book.sessionId, 0);
  expect(writes).toBe(1);
  controller.dispose();
});
test('lazy wide classification isolates discovered scans while retaining the requested page', async () => {
  const { api } = fakeApi();
  api.openSelected = async () => ({
    ...book,
    pages: Array.from({ length: 5 }, (_, i) => ({ id: String(i) })),
  });
  api.loadPage = async (_s, id) => ({
    ...resource(),
    width: id === '2' ? 1600 : 600,
    height: 1000,
  });
  const controller = new ReaderController(api);
  await controller.open();
  controller.setPresentation('double');
  controller.jump('4');
  const regrouped = deferred<void>();
  const stop = controller.subscribe(() => {
    if (controller.getSnapshot().group.join() === '3,4') regrouped.resolve();
  });
  const plan = controller.cachePlan();
  controller.pages.selectPresentation(
    controller.getSnapshot().book,
    plan.active,
    plan.neighbors,
  );
  await regrouped.promise;
  stop();
  expect(controller.getSnapshot().group).toEqual([3, 4]);
  expect(controller.groups()).toEqual([[0, 1], [2], [3, 4]]);
  controller.dispose();
});

test('a jump within an unresolved pair still preserves its requested page during wide regrouping', async () => {
  const { api } = fakeApi();
  const pending = deferred<ReturnType<typeof resource>>();
  api.loadPage = () => pending.promise;
  const controller = new ReaderController(api);
  await controller.open();
  controller.setPresentation('double');
  const plan = controller.cachePlan();
  controller.pages.selectPresentation(
    controller.getSnapshot().book,
    plan.active,
    plan.neighbors,
  );
  controller.jump('2');
  const resolved = deferred<void>();
  const stop = controller.subscribe(() => {
    if (controller.getSnapshot().group.join() === '1') resolved.resolve();
  });
  pending.resolve({ ...resource(), width: 1600, height: 1000 });
  await resolved.promise;
  expect(controller.getSnapshot().group).toEqual([1]);
  stop();
  controller.dispose();
});

test('late presentation during replacement cannot enqueue old-session progress after its flush', async () => {
  const { api } = fakeApi();
  let writes = 0;
  api.openSelected = async () => ({
    ...book,
    libraryBookId: '9'.repeat(32),
    pages: [book.pages[0]!],
  });
  api.recordProgress = async () => {
    writes++;
  };
  const controller = new ReaderController(api);
  await controller.open();
  const gate = deferred<null>();
  const entered = deferred<void>();
  api.openSelected = () => {
    entered.resolve();
    return gate.promise;
  };
  const opening = controller.open();
  await entered.promise;
  controller.presentedPage(book.sessionId, 0);
  await controller.progress.flush();
  expect(writes).toBe(0);
  gate.resolve(null);
  await opening;
  controller.dispose();
});
