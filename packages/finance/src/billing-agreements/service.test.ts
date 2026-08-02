import { describe, expect, it, vi } from 'vitest';

import { stableFinancialHash } from './fingerprint';
import { createBillingAgreementLifecycleService } from './service';
import type {
  BillingAgreementChangeInput,
  BillingAgreementChangeResult,
  CommitBillingAgreementChangeInput,
} from './types';

describe('BillingAgreementLifecycleService idempotency', () => {
  it('devolve commit concluído sem reler acordo nem exigir preview ainda vigente', async () => {
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'retry',
      kind: 'ADD_ALLOCATION', effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-31',
      allocations: [{
        enrollmentId: 'enrollment-1', studentId: 'student-1', kind: 'TUITION', recurring: true,
        baseAmountCents: 15_000, netAmountCents: 15_000,
      }],
    };
    const input: CommitBillingAgreementChangeInput = {
      ...change,
      uiRequestId: 'request-1', previewHash: 'preview-1',
      previewExpiresAt: '2026-07-31T11:00:00.000Z', expectedAgreementVersion: 1,
    };
    const result: BillingAgreementChangeResult = {
      operationId: 'operation-1', uiRequestId: 'request-1', status: 'COMPLETED',
      agreementIds: ['agreement-1'], resultingAmountsCents: { 'agreement-1': 15_000 },
      versions: { 'agreement-1': 2 }, adjustments: [], remoteProgress: [], correlationId: 'correlation-1',
    };
    const getAgreementContext = vi.fn();
    const repository = {
      getAgreementContext,
      getOperationByRequest: vi.fn().mockResolvedValue({
        id: 'operation-1', contaId: 'conta-1', uiRequestId: 'request-1', kind: 'ADD_ALLOCATION',
        status: 'COMPLETED',
        requestFingerprint: stableFinancialHash({ change, previewHash: 'preview-1', expectedAgreementVersion: 1 }),
        sourceAgreementId: 'agreement-1', targetAgreementId: null, expectedVersion: 1,
        previewHash: 'preview-1', effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-31',
        correlationId: 'correlation-1', remoteProgress: [], result, errorCode: null,
      }),
    };
    const service = createBillingAgreementLifecycleService({
      repository: repository as never,
      asaas: {} as never,
      lock: { withAgreementLocks: async ({ run }) => ({ acquired: true as const, result: await run() }) },
      audit: { record: vi.fn() },
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });

    await expect(service.commit(input)).resolves.toEqual(result);
    expect(getAgreementContext).not.toHaveBeenCalled();
  });
});
