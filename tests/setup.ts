import { ViewportObserver } from './viewport-observer';
import { Window } from 'happy-dom';
const browser = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  Event: browser.Event,
  ResizeObserver: ViewportObserver,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  KeyboardEvent: browser.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
