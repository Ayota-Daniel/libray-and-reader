import { useReader } from '../features/reader/useReader';
import { ReaderViewport } from '../features/reader/ReaderViewport';
import { ReaderNavigation } from '../features/reader/ReaderNavigation';
export function ReaderScreen() {
  const reader = useReader();
  return (
    <>
      <header>
        <p className="eyebrow">Room for the story</p>
        <h1>Reader</h1>
      </header>
      <ReaderViewport />
      <ReaderNavigation {...reader} />
    </>
  );
}
