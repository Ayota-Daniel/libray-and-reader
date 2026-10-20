import { expect, test } from 'bun:test';
import {
  fitScale,
  zoomFactor,
  zoomStep,
  clampOffset,
} from '../src/features/reader/layout';
import { navigationDelta } from '../src/features/reader/keyboard';
import { readerReducer } from '../src/features/reader/state';

test('fit modes preserve intrinsic aspect ratio and respond to viewport geometry', () => {
  const image = { width: 1000, height: 2000 };
  const viewport = { width: 800, height: 600 };
  expect(fitScale(image, viewport, 'page')).toBe(0.3);
  expect(fitScale(image, viewport, 'width')).toBe(0.8);
  expect(fitScale(image, viewport, 'height')).toBe(0.3);
  expect(fitScale(image, viewport, 'original')).toBe(1);
  expect(fitScale({ width: 2000, height: 1000 }, viewport, 'page')).toBe(0.4);
  expect(fitScale({ width: 2000, height: 1000 }, viewport, 'height')).toBe(0.6);
  expect(fitScale(image, { width: 400, height: 1000 }, 'page')).toBe(0.4);
  expect(fitScale(image, { width: 0, height: Infinity }, 'page')).toBe(1);
});
test('zoom uses deterministic bounded steps, with zero as exact fit reset', () => {
  let step = 0;
  for (let i = 0; i < 50; i++) step = zoomStep(step, 1);
  expect(step).toBe(4);
  expect(zoomFactor(step)).toBe(4);
  for (let i = 0; i < 50; i++) step = zoomStep(step, -1);
  expect(step).toBe(-4);
  expect(zoomFactor(step)).toBe(0.25);
  expect(zoomFactor(0)).toBe(1);
  expect(zoomStep(zoomStep(0, 1), -1)).toBe(0);
  for (const invalid of [NaN, Infinity, -Infinity])
    expect(zoomFactor(invalid)).toBe(1);
});
test('pan offsets stay inside the content and collapse when it fits', () => {
  expect(clampOffset(9000, 1200, 800)).toBe(400);
  expect(clampOffset(-50, 1200, 800)).toBe(0);
  expect(clampOffset(300, 500, 800)).toBe(0);
  expect(clampOffset(300, 1200, 1000)).toBe(200);
  expect(clampOffset(NaN, 1200, 800)).toBe(0);
});
test('LTR and RTL map physical keys to unchanged canonical logical operations', () => {
  const right = new KeyboardEvent('keydown', { key: 'ArrowRight' });
  const left = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
  expect(navigationDelta(right, null, true, 'ltr')).toBe(1);
  expect(navigationDelta(left, null, true, 'ltr')).toBe(-1);
  expect(navigationDelta(right, null, true, 'rtl')).toBe(-1);
  expect(navigationDelta(left, null, true, 'rtl')).toBe(1);
  for (const target of [
    document.createElement('input'),
    document.createElement('select'),
  ]) {
    expect(navigationDelta(left, target, true, 'rtl')).toBeNull();
  }
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  expect(navigationDelta(left, editable, true, 'rtl')).toBeNull();
  expect(
    readerReducer({ pageIndex: 0, pageCount: 3 }, { type: 'step', delta: 1 }),
  ).toEqual({ pageIndex: 1, pageCount: 3 });
});
