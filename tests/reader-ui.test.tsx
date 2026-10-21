import { measureViewport } from './viewport-observer';
import { afterEach, expect, test } from 'bun:test';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/app/App';
import type { ReaderApi, PageResource } from '../src/features/reader/model';
import {
  book,
  replacement,
  fakeApi,
  deferred,
  resource,
} from './reader-fixtures';

let root: Root | undefined;
let host: HTMLDivElement;
async function mount(api: ReaderApi, strict = false) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      strict ? (
        <StrictMode>
          <App readerApi={api} />
        </StrictMode>
      ) : (
        <App readerApi={api} />
      ),
    );
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => {
    button.click();
  });
}
async function key(key: string, target: Element | Window = window) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  host?.remove();
});

test('app retains session and position across screens; only Reader owns page resources', async () => {
  const { api, released, closed } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await click('Next page');
  expect(host.textContent).toContain('2 / 2');
  await click('Home');
  expect(released.length).toBeGreaterThan(0);
  expect(closed).toHaveLength(0);
  await key('ArrowLeft');
  await click('Library');
  await click('Settings');
  await click('Reader');
  expect(host.textContent).toContain('2 / 2');
  expect(host.querySelector('img')?.getAttribute('src')).toBe(
    `blob:${book.pages[1]?.id}`,
  );
  await key('ArrowLeft');
  expect(host.textContent).toContain('1 / 2');
  const next = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Next page',
  )!;
  await key('ArrowRight', next);
  expect(host.textContent).toContain('2 / 2');
  await key('ArrowLeft', next);
  expect(host.textContent).toContain('1 / 2');
  const input = document.createElement('input');
  host.append(input);
  await key('ArrowRight', input);
  expect(host.textContent).toContain('1 / 2');
  await click('Close book');
  expect(host.textContent).toContain('No book open');
  expect(closed).toEqual([book.sessionId]);
});

test('late success/error cannot overwrite the active page; resources are disposed', async () => {
  const { api } = fakeApi();
  const first = deferred<PageResource>();
  const second = deferred<PageResource>();
  let count = 0;
  api.loadPage = () => (++count === 1 ? first.promise : second.promise);
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await click('Next page');
  expect(host.querySelector('img') === null).toBe(true);
  const current = resource('blob:new');
  await act(async () => {
    second.resolve(current);
  });
  expect(host.querySelector('img') === null).toBe(true);
  const old = resource('blob:old');
  await act(async () => {
    first.resolve(old);
  });
  expect(old.disposed).toBe(true);
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:new');
  await click('Home');
  expect(current.disposed).toBe(true);
});

test('page errors keep numbering and navigation; stale failures are ignored', async () => {
  const { api } = fakeApi();
  const pending = deferred<PageResource>();
  let count = 0;
  api.loadPage = () => {
    count++;
    return count === 1
      ? pending.promise
      : Promise.reject({ code: 'corrupt_page', message: 'Damaged page' });
  };
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await click('Next page');
  expect(host.textContent).toContain('2 / 2');
  await act(async () => {
    pending.reject({ code: 'read_failed', message: 'Old error' });
  });
  expect(host.textContent).not.toContain('Old error');
  expect(host.textContent).toContain('Damaged page');
  api.loadPage = async () => resource('blob:recovered');
  await click('Previous page');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:recovered');
});

test('A → B → A reuses retained resources and close releases both', async () => {
  const { api, loaded, released } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  const first = host.querySelector('img')?.getAttribute('src');
  await click('Next page');
  await click('Previous page');
  expect(host.querySelector('img')?.getAttribute('src')).toBe(first);
  expect(loaded).toHaveLength(2);
  expect(released).toHaveLength(0);
  await click('Close book');
  expect(released).toHaveLength(2);
  expect(host.querySelector('img') === null).toBe(true);
});

test('StrictMode effect replay does not dispose the live session controller', async () => {
  const { api, closed, loaded, released } = fakeApi();
  await mount(api, true);
  await click('Reader');
  await click('Open CBZ');
  expect(host.textContent).toContain('Test book');
  expect(closed).toHaveLength(0);
  expect(loaded).toHaveLength(2);
  await act(async () => {
    root?.unmount();
    root = undefined;
  });
  expect(closed).toEqual([book.sessionId]);
  expect(released).toHaveLength(2);
});

test('a replaced session cannot publish a late image into the new book', async () => {
  const { api } = fakeApi();
  const pending = deferred<PageResource>();
  api.loadPage = () => pending.promise;
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  api.openSelected = async () => replacement;
  api.loadPage = async () => resource('blob:replacement');
  await click('Open CBZ');
  expect(host.textContent).toContain('Replacement');
  expect(host.textContent).toContain('1 / 1');
  const stale = resource('blob:previous-session');
  await act(async () => {
    pending.resolve(stale);
  });
  expect(stale.disposed).toBe(true);
  expect(host.querySelector('img')?.getAttribute('src')).toBe(
    'blob:replacement',
  );
});

async function setting(index: number, value: string) {
  const select = host.querySelectorAll('select')[index]!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('fit, zoom, direction and resize reuse the current resource; navigation resets zoom', async () => {
  const { api, loaded, released } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  const viewport = host.querySelector<HTMLElement>('.page-scroll')!;
  const image = host.querySelector('img')!;
  await act(async () => {
    image.dispatchEvent(new Event('load'));
    measureViewport(viewport, 800, 600);
  });
  expect(image.style.width).toBe('600px');
  await setting(1, 'width');
  expect(image.style.width).toBe('800px');
  await setting(1, 'height');
  expect(image.style.height).toBe('600px');
  await setting(1, 'original');
  expect(image.style.width).toBe('1px');
  await click('Zoom in');
  expect(host.textContent).toContain('Manual zoom');
  await click('Reset zoom');
  expect(image.style.width).toBe('1px');
  await setting(1, 'width');
  await act(async () => {
    measureViewport(viewport, 400, 500);
  });
  expect(image.style.width).toBe('400px');
  await setting(0, 'rtl');
  expect(
    host.querySelector('.reader-navigation')?.getAttribute('data-direction'),
  ).toBe('rtl');
  expect(host.querySelector('img') === image).toBe(true);
  expect(loaded).toHaveLength(2);
  expect(released).toHaveLength(0);
  expect(loaded[0]?.signal.aborted).toBe(false);
  await click('Zoom in');
  await key('ArrowLeft');
  expect(host.textContent).toContain('2 / 2');
  expect(host.textContent).toContain('Fit mode · 100% of fit');
  expect(loaded).toHaveLength(2);
  await key('ArrowLeft');
  expect(loaded).toHaveLength(2);
  await key('ArrowRight', host.querySelector('select')!);
  expect(host.textContent).toContain('2 / 2');
  await click('Previous page');
  expect(host.textContent).toContain('1 / 2');
  await key('ArrowRight');
  expect(host.textContent).toContain('1 / 2');
  await click('Home');
  await click('Reader');
  expect(host.querySelectorAll('select')[0]?.value).toBe('rtl');
  expect(host.querySelectorAll('select')[1]?.value).toBe('width');
});

test('zoom controls bound manual scale and fit changes reset it', async () => {
  const { api } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  for (let i = 0; i < 8; i++) await click('Zoom in');
  expect(host.textContent).toContain('400% of fit');
  expect(
    [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Zoom in',
    )?.disabled,
  ).toBe(true);
  for (let i = 0; i < 12; i++) await click('Zoom out');
  expect(host.textContent).toContain('25% of fit');
  expect(
    [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Zoom out',
    )?.disabled,
  ).toBe(true);
  await setting(1, 'height');
  expect(host.textContent).toContain('Fit mode · 100% of fit');
  await click('Zoom in');
  await click('Reset zoom');
  expect(host.querySelectorAll('select')[1]?.value).toBe('height');
  expect(host.textContent).toContain('Fit mode · 100% of fit');
});

test('pointer pan clamps, cancels, and resets on fit/page changes without acquisition', async () => {
  const { api, loaded } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  const viewport = host.querySelector<HTMLElement>('.page-scroll')!;
  let captured = false;
  viewport.setPointerCapture = () => {
    captured = true;
  };
  viewport.hasPointerCapture = () => captured;
  viewport.releasePointerCapture = () => {
    captured = false;
  };
  await act(async () => {
    measureViewport(viewport, 400, 300, 1200, 900);
  });
  const pointer = async (type: string, x: number, y: number, id = 1) => {
    await act(async () => {
      viewport.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    });
  };
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', -10000, -10000, 2);
  expect(viewport.scrollLeft).toBe(0);
  await pointer('pointermove', -10000, -10000);
  expect(viewport.scrollLeft).toBe(800);
  expect(viewport.scrollTop).toBe(600);
  await pointer('pointercancel', 0, 0);
  expect(captured).toBe(false);
  await pointer('pointermove', 10000, 10000);
  expect(viewport.scrollLeft).toBe(800);
  await act(async () => {
    measureViewport(viewport, 1000, 800, 1200, 900);
  });
  expect(viewport.scrollLeft).toBe(200);
  expect(viewport.scrollTop).toBe(100);
  await setting(1, 'original');
  expect(viewport.scrollTop).toBe(0);
  expect(viewport.scrollLeft).toBe(0);
  expect(loaded).toHaveLength(2);
  viewport.scrollTop = 50;
  await click('Reset zoom');
  expect(viewport.scrollTop).toBe(0);
  await pointer('pointerdown', 100, 100);
  await act(async () => {
    measureViewport(viewport, 1000, 800, 1200, 900);
  });
  expect(captured).toBe(false);
  viewport.scrollTop = 50;
  await click('Next page');
  expect(host.querySelector('.page-scroll')?.scrollTop).toBe(0);
  expect(host.textContent).toContain('2 / 2');
});

for (const direction of ['ltr', 'rtl']) {
  test(`${direction} preloads canonical next page and uses it without another acquisition`, async () => {
    const { api, loaded } = fakeApi();
    await mount(api);
    await click('Reader');
    await setting(0, direction);
    await click('Open CBZ');
    expect(loaded.map((call) => call.pageId)).toEqual(
      book.pages.map((page) => page.id),
    );
    await key(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    expect(host.textContent).toContain('2 / 2');
    expect(loaded).toHaveLength(2);
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      `blob:${book.pages[1]?.id}`,
    );
  });
}

async function jump(value: string) {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Go to page"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
function spreadApi(count = 6) {
  const fake = fakeApi();
  let opens = 0;
  const volume = {
    ...book,
    pages: Array.from({ length: count }, (_, i) => ({ id: String(i) })),
  };
  fake.api.openSelected = async () => {
    opens++;
    return volume;
  };
  return { ...fake, volume, opens: () => opens };
}
test('Double UI: ranges, LTR/RTL placement and keys, jumps, cover and mode switches share one session', async () => {
  const { api, opens } = spreadApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await setting(2, 'double');
  expect(host.textContent).toContain('1–2 / 6');
  expect([...host.querySelectorAll('img')].map((i) => i.alt)).toEqual([
    'Page 1',
    'Page 2',
  ]);
  await key('ArrowRight');
  expect(host.textContent).toContain('3–4 / 6');
  await setting(0, 'rtl');
  expect([...host.querySelectorAll('img')].map((i) => i.alt)).toEqual([
    'Page 4',
    'Page 3',
  ]);
  await key('ArrowLeft');
  expect(host.textContent).toContain('5–6 / 6');
  await key('ArrowRight');
  expect(host.textContent).toContain('3–4 / 6');
  await jump('6');
  expect(host.textContent).toContain('5–6 / 6');
  await jump('1');
  expect(host.textContent).toContain('1–2 / 6');
  await act(async () => {
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  expect(host.textContent).toContain('1 / 6');
  await click('Next page');
  expect(host.textContent).toContain('2–3 / 6');
  await setting(2, 'single');
  expect(host.textContent).toContain('2 / 6');
  await jump('6');
  expect(host.textContent).toContain('6 / 6');
  const input = host.querySelector('input[aria-label="Go to page"]')!;
  await key('ArrowRight', input);
  expect(host.textContent).toContain('6 / 6');
  for (const invalid of ['', 'bad', '0', '-1', '7', '1.5']) {
    await jump(invalid);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('6 / 6');
  }
  expect(opens()).toBe(1);
});
test('composed spread uses one fit/zoom/pan surface, preserves ratios and does not reacquire on settings/resize', async () => {
  const { api } = spreadApi(2);
  let loads = 0;
  api.loadPage = async (_s, id) => {
    loads++;
    return {
      ...resource(`blob:${id}`),
      width: id === '0' ? 600 : 400,
      height: id === '0' ? 1000 : 800,
    };
  };
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await setting(2, 'double');
  const viewport = host.querySelector<HTMLElement>('.page-scroll')!;
  await act(async () => {
    measureViewport(viewport, 1008, 1000);
  });
  const images = [...host.querySelectorAll('img')];
  expect(images[0]!.style.width).toBe('600px');
  expect(images[1]!.style.height).toBe('800px');
  await setting(1, 'width');
  expect(images[0]!.style.width).toBe('600px');
  await setting(1, 'height');
  expect(images[1]!.style.width).toBe('400px');
  await setting(1, 'original');
  await click('Zoom in');
  expect(parseFloat(images[0]!.style.width)).toBeCloseTo(600 * Math.SQRT2);
  await act(async () => {
    measureViewport(viewport, 504, 500);
  });
  await click('Reset zoom');
  await setting(1, 'page');
  expect(images[0]!.style.width).toBe('300px');
  expect(host.querySelectorAll('.page-scroll')).toHaveLength(1);
  expect(loads).toBe(2);
  expect(host.querySelector('img')).toBe(images[0]!);
});
test('wide scan resolves alone, errors remain per slot and retry preserves successful neighbor', async () => {
  const { api } = spreadApi(4);
  let fail = true;
  api.loadPage = async (_s, id) => {
    if (id === '1' && fail)
      throw { code: 'corrupt_page', message: 'Broken slot' };
    return {
      ...resource(`blob:${id}`),
      width: id === '2' ? 1600 : 600,
      height: 1000,
    };
  };
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await setting(2, 'double');
  expect(host.textContent).toContain('Broken slot');
  const first = host.querySelector('img');
  expect(first?.alt).toBe('Page 1');
  fail = false;
  await click('Retry page 2');
  expect(host.querySelector('img') === first).toBe(true);
  expect([...host.querySelectorAll('img')].map((i) => i.alt)).toEqual([
    'Page 1',
    'Page 2',
  ]);
  await click('Next page');
  expect(host.textContent).toContain('3 / 4');
  expect(host.querySelectorAll('img')).toHaveLength(1);
  await click('Next page');
  expect(host.textContent).toContain('4 / 4');
});
test('one-page library completion is sent only after image load succeeds', async () => {
  const { api } = spreadApi(1);
  let writes = 0;
  api.openSelected = async () => ({
    ...book,
    libraryBookId: '9'.repeat(32),
    pages: [book.pages[0]!],
  });
  api.recordProgress = async () => {
    writes++;
  };
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  expect(writes).toBe(0);
  const image = host.querySelector('img')!;
  await act(async () => {
    image.dispatchEvent(new Event('error'));
  });
  expect(writes).toBe(0);
  await act(async () => {
    image.dispatchEvent(new Event('load'));
  });
  expect(writes).toBe(1);
});

test('late spread slot cannot join a new group; replacement and leaving Reader release both slots', async () => {
  const { api, volume } = spreadApi(6);
  const pending = deferred<PageResource>();
  const late = resource('blob:obsolete-slot');
  const released: string[] = [];
  api.loadPage = async (_s, id) => {
    if (id === '1') return pending.promise;
    const page = resource(`blob:${id}`);
    page.dispose = () => {
      released.push(id);
    };
    return page;
  };
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  await setting(2, 'double');
  expect(host.querySelectorAll('img')).toHaveLength(0); // unresolved pair is withheld
  await click('Next page');
  await click('Next page');
  await act(async () => {
    pending.resolve(late);
    await pending.promise;
  });
  expect(late.disposed).toBe(true);
  expect([...host.querySelectorAll('img')].map((i) => i.alt)).toEqual([
    'Page 5',
    'Page 6',
  ]);
  expect(host.querySelector('img[src="blob:obsolete-slot"]')).toBeNull();
  await click('Home');
  expect(released).toContain('4');
  expect(released).toContain('5');
  await click('Reader');
  expect(host.textContent).toContain('5–6 / 6');
  api.openSelected = async () => ({
    ...volume,
    sessionId: 'b'.repeat(32),
    title: 'Second',
    pages: [{ id: 'new0' }, { id: 'new1' }],
  });
  await click('Open CBZ');
  expect(
    [...host.querySelectorAll('img')].map((i) => i.getAttribute('src')),
  ).toEqual(['blob:new0', 'blob:new1']);
  await click('Close book');
  expect(released).toContain('new0');
  expect(released).toContain('new1');
});
