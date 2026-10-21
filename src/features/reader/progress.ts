import type { ReaderApi } from './model';
// One IPC in flight plus one replaceable latest update. No page-turn waits for SQL.
export class ProgressQueue {
  private pending: {
    sessionId: string;
    pageIndex: number;
    lastPageIndex: number | undefined;
  } | null = null;
  private running: Promise<void> | null = null;
  private error: unknown = null;
  private revision = 0;
  private dirty = false;
  private flushing: Promise<void> | null = null;
  constructor(
    private api: ReaderApi,
    private report: (error: unknown) => void,
  ) {}
  record(sessionId: string, pageIndex: number, lastPageIndex?: number) {
    this.pending = { sessionId, pageIndex, lastPageIndex };
    this.dirty = true;
    this.pump();
  }
  private pump() {
    if (this.error || this.running || !this.pending || !this.api.recordProgress)
      return;
    const update = this.pending;
    this.pending = null;
    this.running = this.api
      .recordProgress(
        update.sessionId,
        update.pageIndex,
        ++this.revision,
        update.lastPageIndex,
      )
      .then(
        () => {
          this.error = null;
        },
        (error) => {
          this.pending ??= update;
          this.error = error;
          this.report(error);
        },
      )
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }
  flush(): Promise<void> {
    return (this.flushing ??= this.flushPending().finally(() => {
      this.flushing = null;
    }));
  }
  private async flushPending() {
    while (this.running) await this.running;
    if (this.error) {
      await this.api.flushProgress?.();
      this.error = null;
      this.pump();
      while (this.running) await this.running;
      if (this.error) throw this.error;
    }
    while (this.dirty) {
      while (this.running) await this.running;
      if (this.error) throw this.error;
      await this.api.flushProgress?.();
      if (!this.running && !this.pending) this.dirty = false;
      else if (!this.api.recordProgress) this.dirty = false;
    }
  }
}
