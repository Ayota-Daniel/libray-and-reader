import { describe, expect, test } from 'bun:test';
import {
  initialReaderState,
  readerReducer,
} from '../src/features/reader/state';

describe('reader navigation bounds', () => {
  test('an empty session cannot advance', () => {
    expect(
      readerReducer(initialReaderState, { type: 'step', delta: 1 }),
    ).toEqual(initialReaderState);
  });
  test('navigation stays inside the book and opening resets position', () => {
    let state = readerReducer(initialReaderState, {
      type: 'open',
      pageCount: 2,
    });
    state = readerReducer(state, { type: 'step', delta: -1 });
    expect(state.pageIndex).toBe(0);
    state = readerReducer(state, { type: 'step', delta: 1 });
    state = readerReducer(state, { type: 'step', delta: 1 });
    expect(state.pageIndex).toBe(1);
    expect(readerReducer(state, { type: 'open', pageCount: 1 }).pageIndex).toBe(
      0,
    );
    expect(readerReducer(state, { type: 'close' })).toEqual(initialReaderState);
  });
  test('invalid page counts remain empty', () => {
    for (const pageCount of [-1, NaN, Infinity, 1.5])
      expect(
        readerReducer(initialReaderState, { type: 'open', pageCount }),
      ).toEqual(initialReaderState);
  });
});

test('a single page stays at both boundaries', () => {
  const single = readerReducer(initialReaderState, {
    type: 'open',
    pageCount: 1,
  });
  expect(readerReducer(single, { type: 'step', delta: 1 })).toEqual(single);
  expect(readerReducer(single, { type: 'step', delta: -1 })).toEqual(single);
});
