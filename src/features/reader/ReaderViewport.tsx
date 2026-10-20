import { useState } from 'react';
import { fitScale, zoomFactor, type FitMode, type Size } from './layout';
import { useViewport } from './useViewport';
import { EmptyState } from '../../shared/ui/EmptyState';
import type { PageState } from './usePage';
import type { PageResource } from './model';

function PageImage({
  resource,
  number,
  size,
  fit,
  step,
}: {
  resource: PageResource;
  number: number;
  size: Size;
  fit: FitMode;
  step: number;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const scale = fitScale(resource, size, fit) * zoomFactor(step);
  return (
    <>
      {status === 'loading' && <p role="status">Loading page…</p>}
      {status === 'error' && (
        <p role="alert">
          This page could not be displayed. You can continue to another page.
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
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
    </>
  );
}
export function ReaderViewport({
  page,
  number,
  fit,
  step,
  resetRevision,
}: {
  page: PageState;
  number: number;
  fit: FitMode;
  step: number;
  resetRevision: number;
}) {
  const { ref, size, handlers } = useViewport(
    `${fit}:${step}:${resetRevision}`,
  );
  return (
    <section
      className="reader-viewport"
      aria-label="Reading area"
      aria-busy={page.status === 'loading'}
    >
      <div
        className="page-scroll"
        ref={ref}
        {...handlers}
        tabIndex={0}
        aria-label="Page viewport"
      >
        <div className="page-layout">
          {page.status === 'empty' && (
            <EmptyState title="No book open">
              Choose a local CBZ to start reading. Opening a book does not
              import it into Library.
            </EmptyState>
          )}
          {page.status === 'loading' && <p role="status">Loading page…</p>}
          {page.status === 'error' && <p role="alert">{page.error.message}</p>}
          {page.status === 'ready' && (
            <PageImage
              key={page.resource.url}
              resource={page.resource}
              number={number}
              size={size}
              fit={fit}
              step={step}
            />
          )}
        </div>
      </div>
    </section>
  );
}
