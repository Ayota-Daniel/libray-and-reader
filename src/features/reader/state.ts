// Only an active index and lightweight session metadata, never a book of images.
export interface ReaderState {
  pageCount: number;
  pageIndex: number;
}
export const initialReaderState: ReaderState = { pageCount: 0, pageIndex: 0 };
export type ReaderAction =
  | { type: 'open'; pageCount: number }
  | { type: 'step'; delta: -1 | 1 }
  | { type: 'close' };
export function readerReducer(
  state: ReaderState,
  action: ReaderAction,
): ReaderState {
  switch (action.type) {
    case 'open': {
      const pageCount =
        Number.isSafeInteger(action.pageCount) && action.pageCount > 0
          ? action.pageCount
          : 0;
      return { pageCount, pageIndex: 0 };
    }
    case 'step':
      return {
        ...state,
        pageIndex: Math.max(
          0,
          Math.min(
            Math.max(0, state.pageCount - 1),
            state.pageIndex + action.delta,
          ),
        ),
      };
    case 'close':
      return initialReaderState;
  }
}
