import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ReaderController } from './controller';
import { readerApi } from '../../shared/ipc/reader';
import type { ReaderApi } from './model';

export function useReader(api: ReaderApi = readerApi) {
  const [controller] = useState(() => new ReaderController(api));
  const lifecycleRef = useRef({ generation: 0 });
  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    const generation = ++lifecycle.generation;
    return () => {
      // StrictMode's setup → cleanup → setup must not dispose the live controller.
      queueMicrotask(() => {
        if (generation === lifecycle.generation) controller.dispose();
      });
    };
  }, [controller]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return { controller, snapshot };
}
export type ReaderModel = ReturnType<typeof useReader>;
