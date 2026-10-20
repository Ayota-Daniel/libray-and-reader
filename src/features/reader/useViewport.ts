import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clampOffset, type Size } from './layout';

// Geometry/input only: this hook has no source, session or resource access.
export function useViewport(resetKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const cancelDrag = () => {
    const id = drag.current?.id;
    drag.current = null;
    const element = ref.current;
    if (id !== undefined && element?.hasPointerCapture(id))
      element.releasePointerCapture(id);
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      element.scrollLeft = clampOffset(
        element.scrollLeft,
        element.scrollWidth,
        element.clientWidth,
      );
      element.scrollTop = clampOffset(
        element.scrollTop,
        element.scrollHeight,
        element.clientHeight,
      );
      cancelDrag();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelDrag();
    };
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (element) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
    cancelDrag();
  }, [resetKey]);
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    ref,
    size,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        const element = event.currentTarget;
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          drag.current ||
          (element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight)
        )
          return;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: element.scrollLeft,
          top: element.scrollTop,
        };
        element.setPointerCapture(event.pointerId);
        event.preventDefault();
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const element = event.currentTarget;
        element.scrollLeft = clampOffset(
          start.left + start.x - event.clientX,
          element.scrollWidth,
          element.clientWidth,
        );
        element.scrollTop = clampOffset(
          start.top + start.y - event.clientY,
          element.scrollHeight,
          element.clientHeight,
        );
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture() {
        drag.current = null;
      },
    },
  };
}
