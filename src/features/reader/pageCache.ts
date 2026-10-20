import type {
  PageResource,
  ReaderApi,
  ReaderFailure,
  ReadingSession,
} from './model';
import { failure } from '../../shared/ipc/errors';
export type PageState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; resource: PageResource }
  | { status: 'error'; error: ReaderFailure };
type Entry = {
  index: number;
  state: PageState;
  speculativeFailure?: boolean;
  skipped?: boolean;
};
export const CACHE_LIMIT = 3;
export const CACHE_BYTES = 64 * 1024 * 1024;
const empty: PageState = { status: 'empty' };
const loading: PageState = { status: 'loading' };
const cost = (resource: PageResource) => resource.width * resource.height * 4;

// One owner for encoded resources. No viewport state and no physical input mapping.
export class PageCache {
  private book: ReadingSession | null = null;
  private active = 0;
  private entries = new Map<number, Entry>();
  private running: { entry: Entry; abort: AbortController } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private lease = 0;
  private stopped = false;
  constructor(
    private api: ReaderApi,
    private revision: () => number,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.version;
  private publish() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  attach() {
    return ++this.lease;
  }
  detach(lease: number) {
    queueMicrotask(() => {
      if (this.lease === lease) this.clear();
    });
  }
  peek(sessionId?: string, pageId?: string): PageState {
    if (!sessionId || !pageId) return empty;
    if (this.book?.sessionId !== sessionId) return loading;
    const index = this.book.pages.findIndex((page) => page.id === pageId);
    const entry = this.entries.get(index);
    return entry?.speculativeFailure ? loading : (entry?.state ?? loading);
  }
  // Testable ownership accounting, never exposed in production controls.
  inspect() {
    return {
      indices: [...this.entries.keys()],
      ready: [...this.entries.values()]
        .filter((e) => e.state.status === 'ready')
        .map((e) => e.index),
      bytes: this.bytes(),
      inFlight: this.running ? 1 : 0,
    };
  }
  private bytes() {
    return [...this.entries.values()].reduce(
      (sum, e) =>
        sum + (e.state.status === 'ready' ? cost(e.state.resource) : 0),
      0,
    );
  }
  private priorities() {
    return [this.active, this.active + 1, this.active - 1].filter(
      (i) => i >= 0 && i < (this.book?.pages.length ?? 0),
    );
  }
  select(book: ReadingSession | null, index: number) {
    if (this.stopped) return;
    const changed =
      this.book?.sessionId !== book?.sessionId || this.active !== index;
    if (this.book?.sessionId !== book?.sessionId) this.clear();
    this.book = book;
    this.active = index;
    const wanted = this.priorities();
    for (const entry of this.entries.values())
      if (!wanted.includes(entry.index)) this.evict(entry);
    const active = this.entries.get(index);
    if (changed && active && (active.speculativeFailure || active.skipped))
      this.evict(active);
    // Explicit navigation preempts speculation unless that very request is the target.
    if (
      this.running &&
      this.running.entry.index !== index &&
      this.entries.get(index)?.state.status !== 'ready'
    )
      this.evict(this.running.entry);
    this.trim();
    this.publish();
    this.pump();
  }
  private evict(entry: Entry) {
    if (this.entries.get(entry.index) !== entry) return;
    this.entries.delete(entry.index);
    if (this.running?.entry === entry) this.running.abort.abort();
    if (entry.state.status === 'ready') entry.state.resource.dispose();
  }
  private trim() {
    for (const index of this.priorities().reverse()) {
      if (this.bytes() <= CACHE_BYTES) break;
      if (index === this.active) continue;
      const entry = this.entries.get(index);
      if (entry?.state.status === 'ready') {
        entry.state.resource.dispose();
        entry.state = loading;
        entry.skipped = true;
      }
    }
  }
  private pump() {
    if (this.stopped || !this.book || this.running) return;
    const index = this.priorities().find((i) => !this.entries.has(i));
    if (index === undefined || this.entries.size >= CACHE_LIMIT) return;
    const entry: Entry = { index, state: loading };
    this.entries.set(index, entry);
    const abort = new AbortController();
    const work = { entry, abort };
    this.running = work;
    const book = this.book;
    void this.api
      .loadPage(
        book.sessionId,
        book.pages[index]!.id,
        this.revision(),
        abort.signal,
      )
      .then(
        (resource) => {
          if (
            abort.signal.aborted ||
            this.entries.get(index) !== entry ||
            this.book !== book
          ) {
            resource.dispose();
            return;
          }
          entry.state = { status: 'ready', resource };
          this.trim();
        },
        (error) => {
          if (
            !abort.signal.aborted &&
            this.entries.get(index) === entry &&
            this.book === book
          ) {
            entry.state = { status: 'error', error: failure(error) };
            entry.speculativeFailure = index !== this.active;
          }
        },
      )
      .finally(() => {
        if (this.running === work) this.running = null;
        this.publish();
        this.pump();
      });
  }
  clear() {
    for (const entry of this.entries.values()) this.evict(entry);
    this.running?.abort.abort();
    this.book = null;
    this.publish();
  }
  dispose() {
    this.stopped = true;
    ++this.lease;
    this.clear();
    this.listeners.clear();
  }
}
