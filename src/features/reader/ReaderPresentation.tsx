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
  page,
  number,
}: {
  reader: ReaderModel;
  page: PageState;
  number: number;
}) {
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
      <ReaderViewport
        page={page}
        number={number}
        fit={reader.fit}
        step={step}
        resetRevision={resetRevision}
      />
    </>
  );
}
