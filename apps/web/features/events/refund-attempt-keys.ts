function createKey() {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `event-refund:${id}`;
}

export function isTerminalRefundAttemptError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown };
  return typeof candidate.status === 'number'
    && candidate.status >= 400
    && candidate.status < 500
    && candidate.status !== 408;
}

export class RefundAttemptKeys {
  private readonly keys = new Map<string, string>();

  get(operationId: string) {
    const current = this.keys.get(operationId);
    if (current) return current;
    const next = createKey();
    this.keys.set(operationId, next);
    return next;
  }

  complete(operationId: string) {
    this.keys.delete(operationId);
  }

  fail(operationId: string, error: unknown) {
    if (isTerminalRefundAttemptError(error)) this.keys.delete(operationId);
  }
}
