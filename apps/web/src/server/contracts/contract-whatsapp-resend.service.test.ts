import { describe, expect, it, vi } from 'vitest';
import { persistContractWhatsAppResendOperation } from './contract-whatsapp-resend.service';

describe('contract WhatsApp resend operation idempotency', () => {
  it('does not enqueue again for replay A after distinct operation B', async () => {
    const operations = new Set<string>();
    const create = vi.fn(async ({ data }: { data: { operationId: string } }) => {
      operations.add(data.operationId);
      return { id: `operation-${data.operationId}` };
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeTx = {
      contractWhatsAppResendOperation: {
        findUnique: vi.fn(async ({ where }: { where: { uq_contract_whatsapp_resend_operation: { operationId: string } } }) =>
          operations.has(where.uq_contract_whatsapp_resend_operation.operationId) ? { id: 'known' } : null),
        create,
      },
      contractWhatsAppNotification: { updateMany },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
    };

    const input = { contaId: 'conta-1', notificationId: 'notice-1', recipientPhone: '+5511999999999' };
    const firstA = await persistContractWhatsAppResendOperation(fakeTx as never, { ...input, operationId: 'op-a' });
    const operationB = await persistContractWhatsAppResendOperation(fakeTx as never, { ...input, operationId: 'op-b' });
    const replayA = await persistContractWhatsAppResendOperation(fakeTx as never, { ...input, operationId: 'op-a' });

    expect(firstA).toBe(true);
    expect(operationB).toBe(true);
    expect(replayA).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
