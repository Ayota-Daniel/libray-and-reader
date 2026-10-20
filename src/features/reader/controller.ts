import { PageCache } from './pageCache';
import { failure } from '../../shared/ipc/errors';
import type { ReaderApi, ReaderFailure, ReadingSession } from './model';
import { readerReducer } from './state';

export interface ReaderSnapshot {
  book: ReadingSession | null;
  pageIndex: number;
  opening: boolean;
  closing: boolean;
  error: ReaderFailure | null;
}
// Small volatile controller owned by the app, never by an individual screen.
export class ReaderController {
  private snapshot: ReaderSnapshot = {
    book: null,
    pageIndex: 0,
    opening: false,
    closing: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private operationId: string | null = null;
  private revision = 0;
  private disposed = false;
  readonly pages: PageCache;
  constructor(readonly api: ReaderApi) {
    this.pages = new PageCache(api, this.nextRevision);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ReaderSnapshot>) {
    if (this.disposed) return;
    if (
      'book' in patch &&
      patch.book?.sessionId !== this.snapshot.book?.sessionId
    )
      this.pages.clear();
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  nextRevision = () => ++this.revision;
  private async cleanup(work: Promise<void>) {
    try {
      await work;
    } catch (error) {
      if (failure(error).code !== 'session_expired')
        this.update({ error: failure(error) });
    }
  }
  open = async () => {
    if (this.disposed || this.snapshot.opening || this.snapshot.closing) return;
    const generation = ++this.generation;
    this.update({ opening: true, error: null });
    let operation: string | null = null;
    try {
      operation = await this.api.beginOpen();
      if (this.disposed || generation !== this.generation) {
        await this.cleanup(this.api.cancelOpen(operation));
        return;
      }
      this.operationId = operation;
      const book = await this.api.openSelected(operation);
      if (this.disposed || generation !== this.generation) {
        if (book) await this.cleanup(this.api.closeBook(book.sessionId));
        return;
      }
      if (book) this.update({ book, pageIndex: 0 });
    } catch (error) {
      if (!this.disposed && generation === this.generation)
        this.update({ error: failure(error) });
    } finally {
      if (this.operationId === operation) this.operationId = null;
      if (generation === this.generation) this.update({ opening: false });
    }
  };
  close = async () => {
    if (this.disposed || this.snapshot.closing) return;
    ++this.generation;
    const book = this.snapshot.book;
    const operation = this.operationId;
    this.operationId = null;
    this.update({ closing: true, opening: false, error: null });
    if (operation) await this.cleanup(this.api.cancelOpen(operation));
    try {
      if (book) await this.api.closeBook(book.sessionId);
      this.update({ book: null, pageIndex: 0 });
    } catch (error) {
      if (failure(error).code === 'session_expired')
        this.update({ book: null, pageIndex: 0 });
      else this.update({ error: failure(error) });
    } finally {
      this.update({ closing: false });
    }
  };
  step = (delta: -1 | 1) => {
    if (this.disposed || this.snapshot.closing) return;
    const { book, pageIndex } = this.snapshot;
    const next = readerReducer(
      { pageCount: book?.pages.length ?? 0, pageIndex },
      { type: 'step', delta },
    );
    this.update({ pageIndex: next.pageIndex });
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.pages.dispose();
    ++this.generation;
    const book = this.snapshot.book;
    if (this.operationId)
      void this.cleanup(this.api.cancelOpen(this.operationId));
    if (book) void this.cleanup(this.api.closeBook(book.sessionId));
    this.listeners.clear();
  };
}
