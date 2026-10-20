import { useReducer } from 'react';
import { initialReaderState, readerReducer } from './state';
export function useReader() {
  const [state, dispatch] = useReducer(readerReducer, initialReaderState);
  return {
    state,
    previous: () => dispatch({ type: 'step', delta: -1 }),
    next: () => dispatch({ type: 'step', delta: 1 }),
  };
}
