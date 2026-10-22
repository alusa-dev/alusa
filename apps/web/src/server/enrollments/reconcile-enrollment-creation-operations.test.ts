import { describe, expect, it, vi } from 'vitest';

const { reconcileMock } = vi.hoisted(() => ({ reconcileMock: vi.fn() }));

vi.mock('@alusa/finance', () => ({
  reconcileEnrollmentCreationOperations: reconcileMock,
}));

import { reconcileEnrollmentCreationOperations } from './reconcile-enrollment-creation-operations';

describe('reconcileEnrollmentCreationOperations app adapter', () => {
  it('delega a reconciliação financeira ao use case e preserva os parâmetros do job', async () => {
    const summary = { inspected: 2, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 };
    reconcileMock.mockResolvedValueOnce(summary);

    await expect(reconcileEnrollmentCreationOperations({ contaId: 'conta-1', limit: 12, olderThanSeconds: 300 }))
      .resolves.toBe(summary);
    expect(reconcileMock).toHaveBeenCalledWith({ contaId: 'conta-1', limit: 12, olderThanSeconds: 300 });
  });
});
