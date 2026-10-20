import { EmptyState } from '../../shared/ui/EmptyState';
export function ReaderViewport() {
  return (
    <section className="reader-viewport" aria-label="Reading area">
      <EmptyState title="No book open">
        Pages will appear here when a content source is connected.
      </EmptyState>
    </section>
  );
}
