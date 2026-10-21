import { ProgressQueue } from './progress';
import { PageCache } from './pageCache';
import { failure } from '../../shared/ipc/errors';
import type { ReaderApi, ReaderFailure, ReadingSession } from './model';
import {
  containing,
  isWide,
  pageNumber,
  planGroups,
  type PresentationMode,
} from './presentation';

export interface ReaderSnapshot {
  book: ReadingSession | null;
  pageIndex: number;
  mode: PresentationMode;
  coverAlone: boolean;
  group: readonly number[];
  planRevision: number;
  opening: boolean;
  closing: boolean;
  error: ReaderFailure | null;
}
// Small volatile controller owned by the app, never by an individual screen.
export class ReaderController {
  private snapshot: ReaderSnapshot = {
    book: null,
    pageIndex: 0,
    mode: 'single',
    coverAlone: false,
    group: [],
    planRevision: 0,
    opening: false,
    closing: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private operationId: string | null = null;
  private revision = 0;
  private disposed = false;
  private wide = new Set<number>();
  private known = new Set<number>();
  private presented = new Set<number>();
  private navigated = false;
  readonly pages: PageCache;
  readonly progress: ProgressQueue;
  constructor(readonly api: ReaderApi) {
    this.pages = new PageCache(
      api,
      this.nextRevision,
      (sessionId, index, resource) => {
        if (this.snapshot.book?.sessionId !== sessionId) return;
        const newlyKnown = !this.known.has(index);
        this.known.add(index);
        if (resource && isWide(resource)) this.wide.add(index);
        const group = containing(this.groups(), this.snapshot.pageIndex);
        if (group.join(',') !== this.snapshot.group.join(',')) {
          this.presented.clear();
          this.update({ group, planRevision: this.snapshot.planRevision + 1 });
          if (this.navigated) this.saveProgress();
        } else if (newlyKnown)
          this.update({ planRevision: this.snapshot.planRevision + 1 });
      },
    );
    this.progress = new ProgressQueue(api, (error) =>
      this.update({ error: failure(error) }),
    );
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
  open = async (libraryBookId?: string) => {
    if (this.disposed || this.snapshot.opening || this.snapshot.closing) return;
    const generation = ++this.generation;
    this.update({ opening: true, error: null });
    let operation: string | null = null;
    try {
      await this.progress.flush();
      operation = await this.api.beginOpen();
      if (this.disposed || generation !== this.generation) {
        await this.cleanup(this.api.cancelOpen(operation));
        return;
      }
      this.operationId = operation;
      const book =
        libraryBookId && this.api.openLibrary
          ? await this.api.openLibrary(operation, libraryBookId)
          : await this.api.openSelected(operation);
      if (this.disposed || generation !== this.generation) {
        if (book) await this.cleanup(this.api.closeBook(book.sessionId));
        return;
      }
      if (book) {
        this.wide.clear();
        this.known.clear();
        this.presented.clear();
        this.navigated = false;
        const pageIndex = book.initialPageIndex ?? 0;
        const group = containing(
          planGroups(
            book.pages.length,
            this.snapshot.mode,
            this.snapshot.coverAlone,
            this.wide,
          ),
          pageIndex,
        );
        this.update({ book, pageIndex, group });
      }
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
      await this.progress.flush();
      if (book) await this.api.closeBook(book.sessionId);
      this.update({ book: null, pageIndex: 0, group: [] });
    } catch (error) {
      if (failure(error).code === 'session_expired')
        this.update({ book: null, pageIndex: 0, group: [] });
      else this.update({ error: failure(error) });
    } finally {
      this.update({ closing: false });
    }
  };
  groups() {
    return planGroups(
      this.snapshot.book?.pages.length ?? 0,
      this.snapshot.mode,
      this.snapshot.coverAlone,
      this.wide,
    );
  }
  cachePlan() {
    const groups = this.groups();
    const position = groups.findIndex((g) =>
      g.includes(this.snapshot.pageIndex),
    );
    return {
      active: this.snapshot.group,
      neighbors: [
        ...(groups[position + 1] ?? []),
        ...(groups[position - 1] ?? []),
      ],
    };
  }
  classificationReady() {
    return (
      this.snapshot.mode === 'single' ||
      this.snapshot.group.every(
        (i) =>
          this.known.has(i) ||
          this.pages.peek(
            this.snapshot.book?.sessionId,
            this.snapshot.book?.pages[i]?.id,
          ).status === 'error',
      )
    );
  }
  setPresentation = (
    mode: PresentationMode,
    coverAlone = this.snapshot.coverAlone,
  ) => {
    if (this.snapshot.closing || this.snapshot.opening) return;
    const pageIndex =
      mode === 'single'
        ? (this.snapshot.group[0] ?? this.snapshot.pageIndex)
        : this.snapshot.pageIndex;
    const group = containing(
      planGroups(
        this.snapshot.book?.pages.length ?? 0,
        mode,
        coverAlone,
        this.wide,
      ),
      pageIndex,
    );
    this.update({ mode, coverAlone, pageIndex, group });
    this.presented.clear();
    // A settings change alone is not a reading/completion event.
    this.navigated = false;
  };
  private saveProgress() {
    if (this.snapshot.opening || this.snapshot.closing || this.disposed) return;
    const { book, group } = this.snapshot;
    if (book?.libraryBookId && group.length)
      this.progress.record(book.sessionId, group[0]!, group[group.length - 1]);
  }
  private navigate(index: number) {
    if (this.disposed || this.snapshot.closing || this.snapshot.opening) return;
    const group = containing(this.groups(), index);
    if (!group.length) return;
    if (group.join(',') === this.snapshot.group.join(',')) {
      this.update({ pageIndex: index });
      return;
    }
    this.navigated = true;
    this.presented.clear();
    this.update({ pageIndex: index, group });
    this.saveProgress();
  }
  jump = (value: string): boolean => {
    const index = pageNumber(value, this.snapshot.book?.pages.length ?? 0);
    if (index === null) return false;
    this.navigate(index);
    return true;
  };
  step = (delta: -1 | 1) => {
    const groups = this.groups();
    const position = groups.findIndex((g) =>
      g.includes(this.snapshot.pageIndex),
    );
    const target = groups[position + delta];
    if (target) this.navigate(target[0]!);
  };
  presentationKey() {
    return `${this.snapshot.book?.sessionId}:${this.snapshot.mode}:${this.snapshot.coverAlone}:${this.snapshot.group.join(',')}`;
  }
  presentedPage = (
    sessionId: string,
    index: number,
    presentation = this.presentationKey(),
  ) => {
    const { book, group } = this.snapshot;
    if (
      this.disposed ||
      this.snapshot.closing ||
      this.snapshot.opening ||
      book?.sessionId !== sessionId ||
      presentation !== this.presentationKey() ||
      !group.includes(index) ||
      !this.classificationReady()
    )
      return;
    if (this.presented.has(index)) return;
    this.presented.add(index);
    if (
      group.every((i) => this.presented.has(i)) &&
      group.includes(book.pages.length - 1)
    )
      this.saveProgress();
  };
  prepareShutdown = async () => {
    this.update({ closing: true });
    try {
      await this.progress.flush();
    } catch (error) {
      this.update({ closing: false, error: failure(error) });
      throw error;
    }
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.pages.dispose();
    ++this.generation;
    const book = this.snapshot.book;
    if (this.operationId)
      void this.cleanup(this.api.cancelOpen(this.operationId));
    if (book)
      void this.cleanup(
        this.progress.flush().then(() => this.api.closeBook(book.sessionId)),
      );
    this.listeners.clear();
  };
}
