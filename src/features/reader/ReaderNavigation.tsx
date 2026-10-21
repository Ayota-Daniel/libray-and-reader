import { useState } from 'react';
import type { ReadingDirection } from './layout';
import type { ReaderState } from './state';
export function ReaderNavigation({
  direction,
  state,
  previous,
  next,
  group,
  jump,
}: {
  direction: ReadingDirection;
  state: ReaderState;
  previous: () => void;
  next: () => void;
  group: readonly number[];
  jump: (value: string) => boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  return (
    <div
      className="reader-navigation"
      data-direction={direction}
      aria-label="Page navigation"
      role="group"
    >
      <button
        onClick={previous}
        disabled={state.pageCount === 0 || (group[0] ?? 0) === 0}
      >
        Previous page
      </button>
      <span role="status" aria-label="Current pages">
        {state.pageCount === 0
          ? 'No pages'
          : `${(group[0] ?? state.pageIndex) + 1}${group.length === 2 ? `–${group[1]! + 1}` : ''} / ${state.pageCount}`}
      </span>
      <button
        onClick={next}
        disabled={
          state.pageCount === 0 ||
          (group[group.length - 1] ?? state.pageIndex) >= state.pageCount - 1
        }
      >
        Next page
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(!jump(value));
        }}
      >
        <label>
          Go to page{' '}
          <input
            aria-label="Go to page"
            inputMode="numeric"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(false);
            }}
            aria-invalid={error}
            aria-describedby={error ? 'page-jump-error' : undefined}
          />
        </label>
        <button type="submit" disabled={!state.pageCount}>
          Go
        </button>
        {error && (
          <span id="page-jump-error" role="alert">
            Enter a whole page number from 1 to {state.pageCount}.
          </span>
        )}
      </form>
    </div>
  );
}
