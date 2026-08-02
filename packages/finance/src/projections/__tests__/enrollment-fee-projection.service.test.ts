import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    $transaction: vi.fn(),
    cobranca: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
    matriculaFamiliar: { findFirst: vi.fn() },
    familyFinancialAllocation: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));
import { prisma } from '@alusa/database';
import {
  projectAcademicEnrollmentFeeState,
  projectFamilyEnrollmentFeeState,
  projectionFromAcademicCharge,
  projectionFromStandaloneCharge,
} from '../enrollment-fee-projection.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrollment fee projection', () => {
  it('projeta pagamento confirmado sem confundir provisionamento com pagamento', () => {
    expect(projectionFromAcademicCharge('PAGO')).toEqual({
      taxaStatus: 'PAGO',
      financeStatus: 'ADIMPLENTE',
      allocationStatus: 'PAID',
    });
    expect(projectionFromStandaloneCharge('PAID')).toEqual({
      taxaStatus: 'PAGO',
      financeStatus: 'ADIMPLENTE',
      allocationStatus: 'PAID',
    });
  });

  it('projeta estorno e cancelamento como taxa não quitada', () => {
    expect(projectionFromAcademicCharge('ESTORNADO')).toEqual(
      expect.objectContaining({ taxaStatus: 'EXPIRADO', financeStatus: 'PENDENTE_TAXA' }),
    );
    expect(projectionFromStandaloneCharge('REFUNDED')).toEqual(
      expect.objectContaining({ taxaStatus: 'EXPIRADO', financeStatus: 'PENDENTE_TAXA' }),
    );
  });

  it('mantém vencimento como inadimplência', () => {
    expect(projectionFromAcademicCharge('ATRASADO')).toEqual(
      expect.objectContaining({ taxaStatus: 'PENDENTE', financeStatus: 'INADIMPLENTE' }),
    );
    expect(projectionFromStandaloneCharge('OVERDUE')).toEqual(
      expect.objectContaining({ taxaStatus: 'PENDENTE', financeStatus: 'INADIMPLENTE' }),
    );
  });

  it('ativa uma única vez sob REQUIRES_PAYMENT e isola a conta', async () => {
    let enrollmentStatus = 'PENDENTE_TAXA';
    let enrollmentVersion = 1;
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      matricula: {
        findFirst: vi.fn(async ({ where }: { where: { contaId: string } }) =>
          where.contaId === 'conta-a'
            ? {
                id: 'mat-1',
                alunoId: 'aluno-1',
                aluno: { status: 'ATIVO' },
                status: enrollmentStatus,
                taxaStatus: 'PENDENTE',
                statusFinanceiro: 'PENDENTE_TAXA',
                version: enrollmentVersion,
              }
            : null,
        ),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(async ({ data }: { data: { status?: string } }) => {
          if (data.status === 'ATIVA' && enrollmentStatus === 'PENDENTE_TAXA') {
            enrollmentStatus = 'ATIVA';
            enrollmentVersion += 1;
            return { count: 1 };
          }
          return { count: 1 };
        }),
      },
      cobranca: { findFirst: vi.fn().mockResolvedValue(null) },
      charge: { findFirst: vi.fn().mockResolvedValue(null) },
      conta: { findUnique: vi.fn().mockResolvedValue({ matriculaActivationPolicy: 'REQUIRES_PAYMENT' }) },
      platformBillingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
      matriculaOperacao: { updateMany: vi.fn(), upsert: vi.fn() },
      matriculaLog: { create: vi.fn() },
    };
    vi.mocked(prisma.cobranca.findFirst).mockImplementation(async ({ where }) =>
      where.contaId === 'conta-a'
        ? ({ id: 'fee-1', matriculaId: 'mat-1', status: 'PAGO' } as never)
        : null,
    );
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      (callback as (client: typeof tx) => Promise<unknown>)(tx),
    );

    await projectAcademicEnrollmentFeeState({
      contaId: 'conta-a',
      cobrancaId: 'fee-1',
      eventName: 'PAYMENT_RECEIVED',
    });
    await projectAcademicEnrollmentFeeState({
      contaId: 'conta-a',
      cobrancaId: 'fee-1',
      eventName: 'PAYMENT_RECEIVED_DUPLICATE',
    });
    const crossTenant = await projectAcademicEnrollmentFeeState({
      contaId: 'conta-b',
      cobrancaId: 'fee-1',
      eventName: 'PAYMENT_RECEIVED',
    });

    expect(enrollmentStatus).toBe('ATIVA');
    expect(tx.matriculaLog.create).toHaveBeenCalledTimes(1);
    expect(crossTenant).toEqual({ projected: false, reason: 'FEE_NOT_FOUND' });
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-b' }) }),
    );
  });

  it('mantém pagamento e registra divergência quando o plano comercial bloqueia ativação', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      matricula: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'mat-1',
            alunoId: 'aluno-1',
            aluno: { status: 'ATIVO' },
            status: 'PENDENTE_TAXA',
            taxaStatus: 'PENDENTE',
            statusFinanceiro: 'PENDENTE_TAXA',
            version: 1,
          })
          .mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 999 }, (_, index) => ({ alunoId: `ativo-${index}` })),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      cobranca: { findFirst: vi.fn().mockResolvedValue(null) },
      charge: { findFirst: vi.fn().mockResolvedValue(null) },
      conta: { findUnique: vi.fn().mockResolvedValue({ matriculaActivationPolicy: 'REQUIRES_PAYMENT' }) },
      platformBillingAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'billing-1',
          contaId: 'conta-a',
          environment: 'TEST',
          status: 'ACTIVE',
          accessStatus: 'ACTIVE',
          planCode: 'STARTER',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          gracePeriodEndsAt: null,
          trialEndsAt: null,
        }),
      },
      matriculaOperacao: { updateMany: vi.fn(), upsert: vi.fn() },
      matriculaLog: { create: vi.fn() },
    };
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue({
      id: 'fee-1',
      matriculaId: 'mat-1',
      status: 'PAGO',
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      (callback as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const result = await projectAcademicEnrollmentFeeState({
      contaId: 'conta-a',
      cobrancaId: 'fee-1',
      eventName: 'PAYMENT_RECEIVED',
    });

    expect(result).toEqual({
      projected: true,
      activation: 'BLOCKED_BY_COMMERCIAL_CAPACITY',
    });
    expect(tx.matriculaOperacao.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'DIVERGENTE', contaId: 'conta-a' }),
      }),
    );
    expect(tx.matriculaLog.create).not.toHaveBeenCalled();
  });

  it('ignora mensalidade familiar antes de validar pagador e bloqueia taxa com pagador divergente', async () => {
    vi.mocked(prisma.charge.findFirst).mockResolvedValue({
      id: 'charge-1',
      status: 'OPEN',
      familyGroupId: 'family-1',
      customer: null,
    } as never);
    vi.mocked(prisma.familyFinancialAllocation.findMany).mockResolvedValueOnce([]);

    await expect(
      projectFamilyEnrollmentFeeState({
        contaId: 'conta-a',
        chargeId: 'charge-1',
        eventName: 'PAYMENT_UPDATED',
      }),
    ).resolves.toEqual({
      projected: false,
      reason: 'FAMILY_FEE_ALLOCATION_NOT_FOUND',
    });
    expect(prisma.matriculaFamiliar.findFirst).not.toHaveBeenCalled();

    vi.mocked(prisma.familyFinancialAllocation.findMany).mockResolvedValueOnce([
      { id: 'allocation-1', matriculaId: 'mat-1' },
    ] as never);
    vi.mocked(prisma.matriculaFamiliar.findFirst).mockResolvedValue({
      id: 'family-1',
      responsavelId: 'responsavel-correto',
    } as never);
    await expect(
      projectFamilyEnrollmentFeeState({
        contaId: 'conta-a',
        chargeId: 'charge-1',
        eventName: 'PAYMENT_UPDATED',
      }),
    ).rejects.toThrow('FAMILY_FEE_PAYER_MISMATCH');
  });
});
