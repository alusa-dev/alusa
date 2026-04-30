import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../foundation/advisory-lock.server', () => ({
  withAdvisoryLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => ({
    acquired: true,
    result: await fn(),
  })),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => ({ id: 'audit_1' })),
  },
}));

import { prisma } from '@alusa/database';

import { auditLogService } from '../../foundation/audit-log.service';
import { encerrarContaAlusa } from '../account/close-account';

describe('encerrarContaAlusa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('desativa a conta localmente e preserva integrações externas', async () => {
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      id: 'conta_1',
      ownerUserId: 'user_1',
      status: 'ATIVO',
      deletedAt: null,
    } as never);
    vi.mocked(prisma.conta.update).mockResolvedValue({ id: 'conta_1' } as never);

    const result = await encerrarContaAlusa({
      contaId: 'conta_1',
      confirmText: 'DESATIVAR',
      reason: 'Encerramento solicitado pelo cliente',
      actor: { type: 'ADMIN', id: 'user_1', role: 'ADMIN' },
      requestId: 'req_1',
      ip: '127.0.0.1',
    });

    expect(result).toMatchObject({
      success: true,
      result: 'DEACTIVATED_INTERNAL',
      asaasAttempted: false,
      asaasSuccess: false,
    });
    expect(prisma.conta.update).toHaveBeenCalledWith({
      where: { id: 'conta_1' },
      data: expect.objectContaining({
        status: 'INATIVO',
        deletedByUserId: 'user_1',
        deleteReason: 'Encerramento solicitado pelo cliente',
        deletedAt: expect.any(Date),
      }),
    });
    expect(auditLogService.record).toHaveBeenCalledWith({
      contaId: 'conta_1',
      action: 'conta.deactivated',
      entity: { type: 'Conta', id: 'conta_1' },
      metadata: expect.objectContaining({
        reason: 'Encerramento solicitado pelo cliente',
        preservedFinancialHistory: true,
        preservedExternalAccount: true,
      }),
      actor: { type: 'ADMIN', id: 'user_1' },
    });
  });

  it('é idempotente quando a conta já está desativada', async () => {
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      id: 'conta_1',
      ownerUserId: 'user_1',
      status: 'INATIVO',
      deletedAt: new Date('2026-04-28T00:00:00.000Z'),
    } as never);

    const result = await encerrarContaAlusa({
      contaId: 'conta_1',
      confirmText: 'DESATIVAR',
      reason: 'Nova tentativa',
      actor: { type: 'ADMIN', id: 'user_1', role: 'ADMIN' },
    });

    expect(result).toMatchObject({ success: true, result: 'DEACTIVATED_INTERNAL' });
    expect(prisma.conta.update).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });
});
