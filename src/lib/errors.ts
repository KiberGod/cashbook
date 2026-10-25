import type { ValidationIssue } from './schema';

export type ErrorCode =
  | 'noClientId'
  | 'badLink'
  | 'popupBlocked'
  | 'popupClosed'
  | 'scopeDenied'
  | 'auth'
  | 'forbidden'
  | 'readOnly'
  | 'notFound'
  | 'apiDisabled'
  | 'network'
  | 'invalid'
  | 'formatChanged'
  | 'unknown';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string,
    public issues: ValidationIssue[] = [],
  ) {
    super(message ?? code);
  }
}

export const toAppError = (e: unknown): AppError =>
  e instanceof AppError ? e : new AppError('unknown', e instanceof Error ? e.message : String(e));
