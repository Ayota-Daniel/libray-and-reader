import { useState } from 'react';
import { EmptyState } from '../../shared/ui/EmptyState';
import type { PageState } from './usePage';
import type { PageResource } from './model';

function PageImage({
  resource,
  number,
}: {
  resource: PageResource;
  number: number;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  return (
    <>
      {status === 'loading' && <p role="status">Loading page…</p>}
      {status === 'error' && (
        <p role="alert">
          This page could not be displayed. You can continue to another page.
        </p>
      )}
      <img
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
}: {
  page: PageState;
  number: number;
}) {
  return (
    <section
      className="reader-viewport"
      aria-label="Reading area"
      aria-busy={page.status === 'loading'}
    >
      {page.status === 'empty' && (
        <EmptyState title="No book open">
          Choose a local CBZ to start reading. Opening a book does not import it
          into Library.
        </EmptyState>
      )}
      {page.status === 'loading' && <p role="status">Loading page…</p>}
      {page.status === 'error' && <p role="alert">{page.error.message}</p>}
      {page.status === 'ready' && (
        <PageImage
          key={page.resource.url}
          resource={page.resource}
          number={number}
        />
      )}
    </section>
  );
}
