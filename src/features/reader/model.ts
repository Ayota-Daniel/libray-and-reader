export interface ReadingSession {
  sessionId: string;
  title: string;
  libraryBookId?: string;
  initialPageIndex?: number;
  pages: readonly { id: string }[];
}

export interface ReaderFailure {
  code: string;
  message: string;
}

export interface PageResource {
  url: string;
  width: number;
  height: number;
  dispose: () => void;
}

// Source-independent boundary. No filenames, ZIP entries, or transport URLs in state.
export interface ReaderApi {
  beginOpen(): Promise<string>;
  openLibrary?(operationId: string, bookId: string): Promise<ReadingSession>;
  recordProgress?(
    sessionId: string,
    pageIndex: number,
    revision: number,
  ): Promise<void>;
  flushProgress?(): Promise<void>;
  openSelected(operationId: string): Promise<ReadingSession | null>;
  cancelOpen(operationId: string): Promise<void>;
  closeBook(sessionId: string): Promise<void>;
  loadPage(
    sessionId: string,
    pageId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<PageResource>;
}
