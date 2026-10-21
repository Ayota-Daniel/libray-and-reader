import { useState } from 'react';
import {
  fitScale,
  zoomFactor,
  type FitMode,
  type Size,
  type ReadingDirection,
} from './layout';
import { composedSize, SPREAD_GUTTER } from './presentation';
import { useViewport } from './useViewport';
import { EmptyState } from '../../shared/ui/EmptyState';
import type { PageState } from './usePage';
import type { PageResource } from './model';
function PageImage({
  resource,
  number,
  scale,
  presented,
  retry,
}: {
  resource: PageResource;
  number: number;
  scale: number;
  presented: () => void;
  retry: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  return (
    <>
      {status === 'loading' && <p role="status">Loading page…</p>}
      {status === 'error' && (
        <p role="alert">
          This page could not be displayed.{' '}
          <button onClick={retry}>Retry page {number}</button>
        </p>
      )}
      <img
        draggable={false}
        style={{
          width: resource.width * scale,
          height: resource.height * scale,
        }}
        src={resource.url}
        alt={`Page ${number}`}
        width={resource.width}
        height={resource.height}
        hidden={status !== 'ready'}
        onLoad={() => {
          setStatus('ready');
          presented();
        }}
        onError={() => setStatus('error')}
      />
    </>
  );
}
export function ReaderViewport({
  slots,
  direction,
  classified,
  presented,
  retry,
  fit,
  step,
  resetRevision,
}: {
  slots: { index: number; page: PageState }[];
  direction: ReadingDirection;
  classified: boolean;
  presented: (index: number) => void;
  retry: (index: number) => void;
  fit: FitMode;
  step: number;
  resetRevision: number;
}) {
  const { ref, size, handlers } = useViewport(
    `${fit}:${step}:${resetRevision}:${classified}`,
  );
  const dimensions: Size[] = slots.map(({ page }) =>
    page.status === 'ready' ? page.resource : { width: 320, height: 480 },
  );
  const scale =
    fitScale(composedSize(dimensions), size, fit) * zoomFactor(step);
  const visual = direction === 'rtl' ? [...slots].reverse() : slots;
  return (
    <section
      className="reader-viewport"
      aria-label="Reading area"
      aria-busy={!classified || slots.some((s) => s.page.status === 'loading')}
    >
      <div
        className="page-scroll"
        ref={ref}
        {...handlers}
        tabIndex={0}
        aria-label="Page viewport"
      >
        <div className="page-layout">
          {!slots.length && (
            <EmptyState title="No book open">
              Choose a local CBZ to start reading. Opening a book does not
              import it into Library.
            </EmptyState>
          )}
          {!classified && <p role="status">Loading presentation…</p>}
          {classified && (
            <div
              className="spread-layout"
              style={{ gap: slots.length > 1 ? SPREAD_GUTTER * scale : 0 }}
            >
              {visual.map(({ index, page }) => (
                <div className="page-slot" key={index}>
                  {page.status === 'loading' && (
                    <p role="status">Loading page…</p>
                  )}
                  {page.status === 'error' && (
                    <p role="alert">
                      {page.error.message}{' '}
                      <button onClick={() => retry(index)}>
                        Retry page {index + 1}
                      </button>
                    </p>
                  )}
                  {page.status === 'ready' && (
                    <PageImage
                      key={page.resource.url}
                      resource={page.resource}
                      number={index + 1}
                      scale={scale}
                      presented={() => presented(index)}
                      retry={() => retry(index)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
