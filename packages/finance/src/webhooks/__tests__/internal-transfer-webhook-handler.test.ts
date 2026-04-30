import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInternalTransferWebhook } from '../internal-transfer-webhook-handler';

// Mock do auditLogService
vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn().mockResolvedValue(undefined),
  },
}));

import { auditLogService } from '../../foundation/audit-log.service';

describe('handleInternalTransferWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra INTERNAL_TRANSFER_CREDIT com sucesso', async () => {
    const result = await handleInternalTransferWebhook('conta-123', {
      event: 'INTERNAL_TRANSFER_CREDIT',
      transfer: {
        id: 'transfer-abc',
        value: 1000,
        netValue: 950,
        description: 'Repasse mensal',
        dateCreated: '2026-01-21',
        status: 'DONE',
      },
    });

    expect(result.success).toBe(true);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-123',
        action: 'finance.webhook.internal_transfer_received',
        entity: { type: 'InternalTransfer', id: 'transfer-abc' },
        metadata: expect.objectContaining({
          event: 'INTERNAL_TRANSFER_CREDIT',
          value: 1000,
        }),
      })
    );
  });

  it('registra INTERNAL_TRANSFER_DEBIT com sucesso', async () => {
    const result = await handleInternalTransferWebhook('conta-456', {
      event: 'INTERNAL_TRANSFER_DEBIT',
      transfer: {
        id: 'transfer-xyz',
        value: 500,
      },
    });

    expect(result.success).toBe(true);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-456',
        action: 'finance.webhook.internal_transfer_received',
        entity: { type: 'InternalTransfer', id: 'transfer-xyz' },
      })
    );
  });

  it('lida com payload mínimo (sem campos opcionais)', async () => {
    const result = await handleInternalTransferWebhook('conta-789', {
      event: 'INTERNAL_TRANSFER_CREDIT',
      transfer: {
        id: 'transfer-minimal',
      },
    });

    expect(result.success).toBe(true);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          value: null,
          netValue: null,
          description: null,
        }),
      })
    );
  });
});
