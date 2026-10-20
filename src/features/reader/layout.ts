export type ReadingDirection = 'ltr' | 'rtl';
export type FitMode = 'page' | 'width' | 'height' | 'original';
export interface Size {
  width: number;
  height: number;
}
export const MIN_ZOOM_STEP = -4;
export const MAX_ZOOM_STEP = 4;
export function zoomStep(current: number, delta: -1 | 1): number {
  return Math.max(
    MIN_ZOOM_STEP,
    Math.min(
      MAX_ZOOM_STEP,
      (Number.isFinite(current) ? Math.round(current) : 0) + delta,
    ),
  );
}
export function zoomFactor(step: number): number {
  return (
    2 **
    (Math.max(
      MIN_ZOOM_STEP,
      Math.min(MAX_ZOOM_STEP, Number.isFinite(step) ? Math.round(step) : 0),
    ) /
      2)
  );
}
export function fitScale(image: Size, viewport: Size, mode: FitMode): number {
  if (
    ![image.width, image.height, viewport.width, viewport.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return 1;
  const width = viewport.width / image.width;
  const height = viewport.height / image.height;
  const scale =
    mode === 'original'
      ? 1
      : mode === 'width'
        ? width
        : mode === 'height'
          ? height
          : Math.min(width, height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
export function clampOffset(
  offset: number,
  content: number,
  viewport: number,
): number {
  if (![offset, content, viewport].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(offset, Math.max(0, content - viewport)));
}
