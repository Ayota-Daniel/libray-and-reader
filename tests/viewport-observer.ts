// Happy DOM has no layout engine: supply explicit measurements in viewport tests.
const observers = new Set<ViewportObserver>();
export class ViewportObserver {
  targets = new Set<Element>();
  constructor(readonly callback: () => void) {
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
}
export function measureViewport(
  element: HTMLElement,
  width: number,
  height: number,
  contentWidth = width,
  contentHeight = height,
) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    scrollWidth: { configurable: true, value: contentWidth },
    scrollHeight: { configurable: true, value: contentHeight },
  });
  for (const observer of observers)
    if (observer.targets.has(element)) observer.callback();
}
