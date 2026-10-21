import { useState } from 'react';
import type { ReaderModel } from './useReader';
import type { PageState } from './usePage';
import { zoomStep } from './layout';
import { ReaderControls } from './ReaderControls';
import { ReaderViewport } from './ReaderViewport';

// Keyed by canonical session/page identity. Navigation resets transformations,
// while direction and fit remain owned above the screens.
export function ReaderPresentation({
  reader,
  slots,
}: {
  reader: ReaderModel;
  slots: { index: number; page: PageState }[];
}) {
  const presentation = reader.controller.presentationKey();
  const [step, setStep] = useState(0);
  const [resetRevision, setResetRevision] = useState(0);
  return (
    <>
      <ReaderControls
        direction={reader.direction}
        fit={reader.fit}
        step={step}
        setDirection={reader.setDirection}
        setFit={(fit) => {
          reader.setFit(fit);
          setStep(0);
        }}
        zoom={(delta) => setStep((current) => zoomStep(current, delta))}
        reset={() => {
          setStep(0);
          setResetRevision((current) => current + 1);
        }}
      />
      <div
        className="reader-controls"
        role="group"
        aria-label="Presentation settings"
      >
        <label>
          Presentation{' '}
          <select
            value={reader.snapshot.mode}
            onChange={(e) =>
              reader.controller.setPresentation(
                e.target.value as 'single' | 'double',
              )
            }
          >
            <option value="single">Single</option>
            <option value="double">Double</option>
          </select>
        </label>
        {reader.snapshot.mode === 'double' && (
          <label>
            <input
              type="checkbox"
              checked={reader.snapshot.coverAlone}
              onChange={(e) =>
                reader.controller.setPresentation('double', e.target.checked)
              }
            />{' '}
            Cover alone
          </label>
        )}
      </div>
      <ReaderViewport
        slots={slots}
        direction={reader.direction}
        classified={reader.controller.classificationReady()}
        presented={(index) =>
          reader.controller.presentedPage(
            reader.snapshot.book?.sessionId ?? '',
            index,
            presentation,
          )
        }
        retry={(index) => reader.controller.pages.retry(index)}
        fit={reader.fit}
        step={step}
        resetRevision={resetRevision}
      />
    </>
  );
}
