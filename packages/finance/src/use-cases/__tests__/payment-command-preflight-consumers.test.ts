import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../payment-command-preflight', () => ({
  readPaymentStatusPreflight: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  confirmCashPayment: vi.fn(),
  deletePayment: vi.fn(),
  updatePayment: vi.fn(),
  isAsaasEnabled: vi.fn(() => true),
  getCurrentBrasiliaDate: vi.fn(() => ({
    dateStr: '2026-01-04',
    dateObj: new Date('2026-01-04T12:00:00.000Z'),
    year: 2026,
    month: 1,
    day: 4,
  })),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

import { prisma } from '@alusa/database';
import { confirmCashPayment, deletePayment, updatePayment } from '../asaas-ops';
import { readPaymentStatusPreflight } from '../payment-command-preflight';
import { deleteCharge } from '../delete-charge';
import { markChargeAsPaid } from '../mark-charge-as-paid';
import { updateCharge } from '../update-charge';

describe('payment-command-preflight consumers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteCharge usa preflight status-only antes de deletar', async () => {
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      matricula: { aluno: { contaId: 'conta-1' } },
    } as never);
    vi.mocked(readPaymentStatusPreflight).mockResolvedValueOnce({ status: 'PENDING' } as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(deletePayment).mockResolvedValueOnce({ id: 'pay_1' } as never);

    const result = await deleteCharge({
      chargeId: 'cob-1',
      contaId: 'conta-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({ success: true });
    expect(readPaymentStatusPreflight).toHaveBeenCalledWith('pay_1', { contaId: 'conta-1' });
    expect(deletePayment).toHaveBeenCalledWith('pay_1', { contaId: 'conta-1' });
  });

  it('updateCharge usa preflight status-only antes de atualizar', async () => {
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      valor: 100,
      vencimento: new Date('2026-01-10T00:00:00.000Z'),
      matricula: { aluno: { contaId: 'conta-1' } },
    } as never);
    vi.mocked(readPaymentStatusPreflight).mockResolvedValueOnce({ status: 'PENDING' } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({ id: 'cob-1' } as never);

    const result = await updateCharge({
      chargeId: 'cob-1',
      contaId: 'conta-1',
      userId: 'user-1',
      changes: { valor: 125 },
    });

    expect(result).toMatchObject({ success: true });
    expect(readPaymentStatusPreflight).toHaveBeenCalledWith('pay_1', { contaId: 'conta-1' });
    expect(updatePayment).toHaveBeenCalledWith('pay_1', { value: 125 }, { contaId: 'conta-1' });
  });

  it('markChargeAsPaid usa preflight status-only antes de confirmar pagamento', async () => {
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      valor: 100,
      asaasPaymentId: 'pay_1',
      matricula: { aluno: { contaId: 'conta-1' } },
    } as never);
    vi.mocked(readPaymentStatusPreflight).mockResolvedValueOnce({ status: 'PENDING' } as never);

    const result = await markChargeAsPaid({
      chargeId: 'cob-1',
      contaId: 'conta-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({ success: true });
    expect(readPaymentStatusPreflight).toHaveBeenCalledWith('pay_1', { contaId: 'conta-1' });
    expect(confirmCashPayment).toHaveBeenCalledWith('pay_1', '2026-01-04', 100, false, { contaId: 'conta-1' });
  });
});
