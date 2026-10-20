import type { ReadingDirection } from './layout';
export function navigationDelta(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'altKey'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'defaultPrevented'
    | 'isComposing'
  >,
  target: EventTarget | null,
  active: boolean,
  direction: ReadingDirection = 'ltr',
): -1 | 1 | null {
  if (
    !active ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  if (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="combobox"]',
    )
  )
    return null;
  const physical =
    event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
  return physical === null
    ? null
    : direction === 'rtl'
      ? physical === 1
        ? -1
        : 1
      : physical;
}
