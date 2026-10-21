export interface LibraryBook {
  id: string;
  sourceKind: 'local_cbz';
  title: string;
  pageCount: number;
  addedAt: number;
  lastOpenedAt: number | null;
  lastPageIndex: number | null;
  progressPageCount: number | null;
  lastReadAt: number | null;
  status: 'unread' | 'reading' | 'completed';
  available: boolean;
}
export interface ImportResult {
  title: string;
  outcome: 'imported' | 'duplicate' | 'failed';
  error: { code: string; message: string } | null;
}
export interface LibraryApi {
  list(): Promise<LibraryBook[]>;
  add(): Promise<ImportResult[]>;
  remove(id: string): Promise<void>;
}
