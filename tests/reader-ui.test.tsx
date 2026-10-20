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
  const { api, released, closed, loaded } = fakeApi();
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
  expect(loaded.at(-1)?.pageId).toBe(book.pages[1]?.id);
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
  expect(host.querySelector('img')).toBeNull();
  const current = resource('blob:new');
  await act(async () => {
    second.resolve(current);
  });
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:new');
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
  expect(host.textContent).toContain('Damaged page');
  expect(host.textContent).toContain('2 / 2');
  await act(async () => {
    pending.reject({ code: 'read_failed', message: 'Old error' });
  });
  expect(host.textContent).not.toContain('Old error');
  api.loadPage = async () => resource('blob:recovered');
  await click('Previous page');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:recovered');
});

test('returning rapidly to the same page does not display its revoked old URL', async () => {
  const { api } = fakeApi();
  await mount(api);
  await click('Reader');
  await click('Open CBZ');
  const pending = deferred<PageResource>();
  api.loadPage = () => pending.promise;
  await click('Next page');
  await click('Previous page');
  expect(host.querySelector('img')).toBeNull();
  await click('Close book');
  const late = resource();
  await act(async () => {
    pending.resolve(late);
  });
  expect(late.disposed).toBe(true);
  expect(host.querySelector('img')).toBeNull();
});

test('StrictMode effect replay does not dispose the live session controller', async () => {
  const { api, closed } = fakeApi();
  await mount(api, true);
  await click('Reader');
  await click('Open CBZ');
  expect(host.textContent).toContain('Test book');
  expect(closed).toHaveLength(0);
  await act(async () => {
    root?.unmount();
    root = undefined;
  });
  expect(closed).toEqual([book.sessionId]);
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
