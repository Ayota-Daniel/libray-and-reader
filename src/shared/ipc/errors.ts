import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ReaderFailure } from '../../features/reader/model';

export class DesktopError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}
export function failure(error: unknown): ReaderFailure {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'communication_failed',
    message: 'The desktop operation failed. Please try again.',
  };
}
export function invalidResponse(): never {
  throw new DesktopError(
    'invalid_response',
    'The desktop core returned an invalid response. Please restart the application.',
  );
}
export async function desktopInvoke(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  if (!isTauri())
    throw new DesktopError(
      'desktop_unavailable',
      'This action needs the desktop application. Start it with bun run dev.',
    );
  try {
    return await invoke(command, args);
  } catch (error) {
    const detail = failure(error);
    throw new DesktopError(detail.code, detail.message);
  }
}
