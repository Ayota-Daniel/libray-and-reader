import type { FitMode, ReadingDirection } from './layout';
import { MAX_ZOOM_STEP, MIN_ZOOM_STEP, zoomFactor } from './layout';
export function ReaderControls({
  direction,
  fit,
  step,
  setDirection,
  setFit,
  zoom,
  reset,
}: {
  direction: ReadingDirection;
  fit: FitMode;
  step: number;
  setDirection: (value: ReadingDirection) => void;
  setFit: (value: FitMode) => void;
  zoom: (delta: -1 | 1) => void;
  reset: () => void;
}) {
  return (
    <div className="reader-controls" role="group" aria-label="Reader settings">
      <label>
        Direction{' '}
        <select
          value={direction}
          onChange={(event) =>
            setDirection(event.target.value as ReadingDirection)
          }
        >
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
      </label>
      <label>
        Fit{' '}
        <select
          value={fit}
          onChange={(event) => setFit(event.target.value as FitMode)}
        >
          <option value="page">Fit Page</option>
          <option value="width">Fit Width</option>
          <option value="height">Fit Height</option>
          <option value="original">Original Size</option>
        </select>
      </label>
      <button onClick={() => zoom(-1)} disabled={step === MIN_ZOOM_STEP}>
        Zoom out
      </button>
      <button onClick={() => zoom(1)} disabled={step === MAX_ZOOM_STEP}>
        Zoom in
      </button>
      <button onClick={reset}>Reset zoom</button>
      <span role="status">
        {step === 0 ? 'Fit mode' : 'Manual zoom'} ·{' '}
        {Math.round(zoomFactor(step) * 100)}% of fit
      </span>
    </div>
  );
}
