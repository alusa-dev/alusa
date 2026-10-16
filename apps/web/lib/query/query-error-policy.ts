function hasHttpStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

export function shouldRetryQueryOnce(failureCount: number, error: unknown): boolean {
  if (hasHttpStatus(error, 429)) return false;
  return failureCount < 1;
}

export function shouldRefetchQueryOnWindowFocus(error: unknown): boolean {
  return !hasHttpStatus(error, 429);
}

export function shouldContinueQueryPolling(error: unknown): boolean {
  return !hasHttpStatus(error, 429);
}
