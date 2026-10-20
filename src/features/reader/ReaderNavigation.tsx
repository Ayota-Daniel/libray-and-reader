import type { ReadingDirection } from './layout';
import type { ReaderState } from './state';
export function ReaderNavigation({
  direction,
  state,
  previous,
  next,
}: {
  direction: ReadingDirection;
  state: ReaderState;
  previous: () => void;
  next: () => void;
}) {
  return (
    <div
      className="reader-navigation"
      data-direction={direction}
      aria-label="Page navigation"
      role="group"
    >
      <button
        onClick={previous}
        disabled={state.pageCount === 0 || state.pageIndex === 0}
      >
        Previous page
      </button>
      <span role="status">
        {state.pageCount === 0
          ? 'No pages'
          : `${state.pageIndex + 1} / ${state.pageCount}`}
      </span>
      <button
        onClick={next}
        disabled={
          state.pageCount === 0 || state.pageIndex >= state.pageCount - 1
        }
      >
        Next page
      </button>
    </div>
  );
}
