import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {} as Record<string, any>,
  countAdditionalActiveStudents: vi.fn(),
  assertStudentCapacity: vi.fn(),
}));

vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: (tx: unknown) => Promise<unknown>) =>
    callback(mocks.tx),
  ),
}));

vi.mock('@/src/server/platform-billing/capacity', () => ({
  countAdditionalActiveStudentsForEnrollment: mocks.countAdditionalActiveStudents,
  assertStudentCapacity: mocks.assertStudentCapacity,
}));

import { activateEnrollmentAtContractStart } from './enrollment-activation.service';

describe('activateEnrollmentAtContractStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countAdditionalActiveStudents.mockResolvedValue(0);
    mocks.assertStudentCapacity.mockResolvedValue(undefined);
    mocks.tx = {
      conta: {
        findFirst: vi.fn().mockResolvedValue({ matriculaActivationPolicy: 'REQUIRES_PAYMENT' }),
      },
      matricula: {
        findFirst: vi.fn().mockResolvedValue({
          alunoId: 'aluno-1',
          status: 'AGUARDANDO_CONFIRMACAO',
          taxaIsenta: false,
          taxaMatricula: 80,
          taxaStatus: 'PENDENTE',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
  });

  it('transiciona para PENDENTE_TAXA quando a política exige pagamento ainda não confirmado', async () => {
    await activateEnrollmentAtContractStart({ contaId: 'conta-1', matriculaId: 'mat-1' });

    expect(mocks.tx.matricula.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'mat-1',
        contaId: 'conta-1',
        status: 'AGUARDANDO_CONFIRMACAO',
        taxaStatus: 'PENDENTE',
      },
      data: { status: 'PENDENTE_TAXA' },
    });
    expect(mocks.assertStudentCapacity).not.toHaveBeenCalled();
  });

  it.each([
    ['PAGO', false, 80],
    ['ISENTO', true, 0],
  ] as const)('ativa no início sem mudar estado financeiro (%s)', async (taxaStatus, taxaIsenta, taxaMatricula) => {
    mocks.tx.matricula.findFirst.mockResolvedValueOnce({
      alunoId: 'aluno-1',
      status: 'AGUARDANDO_CONFIRMACAO',
      taxaIsenta,
      taxaMatricula,
      taxaStatus,
    });

    await activateEnrollmentAtContractStart({ contaId: 'conta-1', matriculaId: 'mat-1' });

    expect(mocks.tx.matricula.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'mat-1',
        contaId: 'conta-1',
        status: 'AGUARDANDO_CONFIRMACAO',
        taxaStatus,
      },
      data: { status: 'ATIVA' },
    });
    expect(mocks.tx.matricula.updateMany.mock.calls[0][0].data).not.toHaveProperty('taxaStatus');
    expect(mocks.assertStudentCapacity).toHaveBeenCalledWith(expect.objectContaining({
      tx: mocks.tx,
      contaId: 'conta-1',
      operation: 'enrollment.scheduled-start.activate',
    }));
  });

  it('mantém PENDENTE_TAXA enquanto taxa exigida estiver pendente', async () => {
    mocks.tx.matricula.findFirst.mockResolvedValueOnce({
      alunoId: 'aluno-1',
      status: 'PENDENTE_TAXA',
      taxaIsenta: false,
      taxaMatricula: 80,
      taxaStatus: 'PENDENTE',
    });

    await expect(activateEnrollmentAtContractStart({ contaId: 'conta-1', matriculaId: 'mat-1' }))
      .resolves.toEqual({ action: 'KEEP', reason: 'FEE_NOT_PAID' });
    expect(mocks.tx.matricula.updateMany).not.toHaveBeenCalled();
  });

  it('não muda estado terminal e mantém o escopo por conta', async () => {
    mocks.tx.matricula.findFirst.mockResolvedValueOnce({
      alunoId: 'aluno-1',
      status: 'CANCELADA',
      taxaIsenta: false,
      taxaMatricula: 80,
      taxaStatus: 'PENDENTE',
    });

    await expect(activateEnrollmentAtContractStart({ contaId: 'conta-1', matriculaId: 'mat-1' }))
      .resolves.toEqual({ action: 'KEEP', reason: 'STATUS_NOT_WAITING_FOR_START' });
    expect(mocks.tx.matricula.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mat-1', contaId: 'conta-1' },
    }));
    expect(mocks.tx.matricula.updateMany).not.toHaveBeenCalled();
  });
});
