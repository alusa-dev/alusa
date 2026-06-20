import { type PrismaClient } from '@prisma/client';

import { createRenewalPending } from './renewal-governance.service';

type IntegrityIssue = {
  processId?: string | null;
  itemId?: string | null;
  code: string;
  title: string;
  message: string;
  severity?: 'WARNING' | 'BLOCKER' | 'CRITICAL';
  metadata?: Record<string, unknown>;
};

async function registerIssue(
  input: { contaId: string; issue: IntegrityIssue },
  deps: { prisma: PrismaClient },
) {
  await createRenewalPending(
    {
      contaId: input.contaId,
      processoId: input.issue.processId ?? null,
      itemId: input.issue.itemId ?? null,
      type: 'INTEGRITY_VIOLATION',
      severity: input.issue.severity ?? 'BLOCKER',
      code: input.issue.code,
      title: input.issue.title,
      message: input.issue.message,
      rule: 'renewal_integrity',
      impact: 'A inconsistência foi registrada para tratamento administrativo sem mutação silenciosa.',
      metadata: input.issue.metadata ?? {},
    },
    deps,
  );
}

export async function runRenewalIntegrityCheck(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
) {
  const now = input.now ?? new Date();
  const processes = await deps.prisma.rematriculaProcesso.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION', 'EFFECTIVE'] },
    },
    include: {
      itens: {
        include: {
          matriculaOrigem: { select: { id: true, dataFimContrato: true, status: true } },
          matriculaFutura: { select: { id: true, status: true, dataInicio: true, turmaId: true, comboId: true } },
        },
      },
      reservas: true,
      financeiros: true,
      contratos: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: input.limit ?? 200,
  });

  const issues: IntegrityIssue[] = [];
  const activeItemKeys = new Map<string, string[]>();
  const futureClassDemand = new Map<string, { capacity: number; itemIds: string[] }>();
  const futureComboDemand = new Map<string, { limit: number; itemIds: string[] }>();

  for (const process of processes) {
    const renewedItems = process.itens.filter((item) => item.decision === 'RENEW');

    if (process.renewCount === 0) {
      if (process.reservas.length > 0 || process.financeiros.length > 0 || process.contratos.length > 0) {
        issues.push({
          processId: process.id,
          code: 'ZERO_RENEW_WITH_EFFECTS',
          title: 'Processo sem renovações possui efeitos futuros',
          message:
            'Um processo com zero itens RENEW possui reserva, contrato ou financeiro futuro associado.',
          severity: 'CRITICAL',
          metadata: {
            reservas: process.reservas.length,
            contratos: process.contratos.length,
            financeiros: process.financeiros.length,
          },
        });
      }
      continue;
    }

    for (const item of renewedItems) {
      const duplicateKey = `${item.matriculaOrigemId}:${item.targetPeriodId}`;
      const ids = activeItemKeys.get(duplicateKey) ?? [];
      ids.push(item.id);
      activeItemKeys.set(duplicateKey, ids);

      if (!item.matriculaFuturaId || !item.matriculaFutura) {
        issues.push({
          processId: process.id,
          itemId: item.id,
          code: 'CONFIRMED_WITHOUT_FUTURE_ENROLLMENT',
          title: 'Item confirmado sem matrícula futura',
          message: 'Um item RENEW confirmado não possui matrícula futura preparada.',
          severity: 'CRITICAL',
        });
      }

      if (
        item.matriculaFutura?.status === 'ATIVA' &&
        process.effectiveAt.getTime() > now.getTime()
      ) {
        issues.push({
          processId: process.id,
          itemId: item.id,
          code: 'FUTURE_ENROLLMENT_ACTIVE_BEFORE_EFFECTIVE_AT',
          title: 'Matrícula futura ativa antes da data efetiva',
          message: 'A matrícula futura está ativa antes de effectiveAt.',
          severity: 'CRITICAL',
          metadata: {
            futureEnrollmentId: item.matriculaFutura.id,
            effectiveAt: process.effectiveAt.toISOString(),
            now: now.toISOString(),
          },
        });
      }

      if (item.matriculaOrigem.dataFimContrato >= process.effectiveAt) {
        issues.push({
          processId: process.id,
          itemId: item.id,
          code: 'CURRENT_FUTURE_OVERLAP',
          title: 'Sobreposição entre vínculo atual e futuro',
          message:
            'A data de fim do contrato atual é maior ou igual à data efetiva do próximo ciclo.',
          severity: 'BLOCKER',
          metadata: {
            currentEndsAt: item.matriculaOrigem.dataFimContrato.toISOString(),
            effectiveAt: process.effectiveAt.toISOString(),
          },
        });
      }

      const hasReservation = process.reservas.some(
        (reservation) =>
          reservation.itemId === item.id &&
          ['RESERVED', 'WAITLISTED', 'CONVERTED'].includes(reservation.status),
      );
      if (!hasReservation) {
        issues.push({
          processId: process.id,
          itemId: item.id,
          code: 'CONFIRMED_WITHOUT_RESERVATION',
          title: 'Item confirmado sem reserva futura',
          message: 'Um item RENEW confirmado não possui reserva futura válida.',
          severity: 'BLOCKER',
        });
      }

      if (item.targetClassId) {
        const targetClass = await deps.prisma.turma.findFirst({
          where: { id: item.targetClassId, contaId: input.contaId },
          select: { id: true, capacidade: true },
        });
        if (targetClass) {
          const key = `${process.targetPeriodId}:${targetClass.id}`;
          const current = futureClassDemand.get(key) ?? { capacity: targetClass.capacidade, itemIds: [] };
          current.itemIds.push(item.id);
          futureClassDemand.set(key, current);
        }
      }

      if (item.targetComboId) {
        const targetCombo = await deps.prisma.combo.findFirst({
          where: { id: item.targetComboId, contaId: input.contaId },
          select: { id: true, vagasLimite: true },
        });
        if (targetCombo?.vagasLimite) {
          const key = `${process.targetPeriodId}:${targetCombo.id}`;
          const current = futureComboDemand.get(key) ?? { limit: targetCombo.vagasLimite, itemIds: [] };
          current.itemIds.push(item.id);
          futureComboDemand.set(key, current);
        }
      }
    }

    if (process.financeiros.length === 0) {
      issues.push({
        processId: process.id,
        code: 'CONFIRMED_WITHOUT_FINANCIAL_AGREEMENT',
        title: 'Processo confirmado sem acordo financeiro futuro',
        message: 'Processo com itens renovados não possui acordo financeiro futuro local.',
        severity: 'BLOCKER',
      });
    }

    for (const financial of process.financeiros) {
      if (financial.status === 'ACTIVE' && financial.effectiveAt > now) {
        issues.push({
          processId: process.id,
          code: 'FUTURE_FINANCE_ACTIVE_BEFORE_EFFECTIVE_AT',
          title: 'Financeiro futuro ativo antes da vigência',
          message: 'O acordo financeiro futuro está ativo antes de effectiveAt.',
          severity: 'CRITICAL',
          metadata: {
            agreementId: financial.id,
            effectiveAt: financial.effectiveAt.toISOString(),
            now: now.toISOString(),
          },
        });
      }

      if (financial.status === 'ACTIVE' && !financial.asaasPaymentId && !financial.asaasSubscriptionId) {
        issues.push({
          processId: process.id,
          code: 'ACTIVE_FINANCE_WITHOUT_EXTERNAL_REFERENCE',
          title: 'Financeiro ativo sem identificador externo',
          message: 'O acordo financeiro está ativo, mas não possui payment/subscription Asaas local.',
          severity: 'BLOCKER',
          metadata: { agreementId: financial.id },
        });
      }

      if (process.status === 'EFFECTIVE' && !['ACTIVE'].includes(financial.status)) {
        issues.push({
          processId: process.id,
          code: 'EFFECTIVE_WITHOUT_ACTIVE_FINANCE',
          title: 'Rematrícula efetivada sem financeiro ativo',
          message: 'O processo está efetivado, mas o acordo financeiro futuro ainda não está ativo.',
          severity: 'BLOCKER',
          metadata: { agreementId: financial.id, financialStatus: financial.status },
        });
      }
    }
  }

  for (const [key, ids] of activeItemKeys.entries()) {
    if (ids.length > 1) {
      const [sourceEnrollmentId, targetPeriodId] = key.split(':');
      issues.push({
        code: 'DUPLICATE_SOURCE_TARGET_PERIOD',
        title: 'Duplicidade de rematrícula para mesmo vínculo/período',
        message: 'Há mais de um item ativo para a mesma matrícula de origem e período destino.',
        severity: 'CRITICAL',
        metadata: { sourceEnrollmentId, targetPeriodId, itemIds: ids },
      });
    }
  }

  for (const [key, demand] of futureClassDemand.entries()) {
    if (demand.itemIds.length > demand.capacity) {
      const [targetPeriodId, targetClassId] = key.split(':');
      issues.push({
        code: 'FUTURE_CLASS_OVER_CAPACITY',
        title: 'Reservas futuras acima da capacidade da turma',
        message: 'A demanda futura confirmada excede a capacidade cadastrada da turma.',
        severity: 'CRITICAL',
        metadata: { targetPeriodId, targetClassId, capacity: demand.capacity, itemIds: demand.itemIds },
      });
    }
  }

  for (const [key, demand] of futureComboDemand.entries()) {
    if (demand.itemIds.length > demand.limit) {
      const [targetPeriodId, targetComboId] = key.split(':');
      issues.push({
        code: 'FUTURE_COMBO_OVER_CAPACITY',
        title: 'Reservas futuras acima do limite do combo',
        message: 'A demanda futura confirmada excede o limite de vagas cadastrado do combo.',
        severity: 'CRITICAL',
        metadata: { targetPeriodId, targetComboId, limit: demand.limit, itemIds: demand.itemIds },
      });
    }
  }

  for (const issue of issues) {
    await registerIssue({ contaId: input.contaId, issue }, deps);
  }

  return {
    checkedProcesses: processes.length,
    issues: issues.length,
    codes: Array.from(new Set(issues.map((issue) => issue.code))).sort(),
  };
}
