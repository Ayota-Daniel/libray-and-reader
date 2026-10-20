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
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}
