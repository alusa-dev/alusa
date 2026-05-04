import { prisma } from '@alusa/database';
import type { ChargeStatus, StatusCobranca } from '@prisma/client';

import { parseExternalReference } from '../core';
import { normalizeChargeStatus, normalizeCobrancaStatus } from '../dtos/unified-billing';
import type { ListStandaloneChargesInput, ListStandaloneChargesOutput, StandaloneChargeItem } from '../use-cases/list-standalone-charges';

type ChargeType = 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';
type LinkStatus = 'LINKED' | 'UNLINKED' | 'NEEDS_REVIEW';

function readModelEnabled(): boolean {
  return process.env.FIN_READMODEL_ENABLED === 'true';
}

function inferChargeType(params: {
  standaloneInstallmentPlanId?: string | null;
  externalReference?: string | null;
  cobrancaTipo?: string | null;
}): ChargeType {
  if (params.standaloneInstallmentPlanId) return 'INSTALLMENT';
  if (params.cobrancaTipo === 'PARCELADA') return 'INSTALLMENT';
  if (params.cobrancaTipo === 'RECORRENTE' || params.cobrancaTipo === 'MENSALIDADE') return 'SUBSCRIPTION';
  if (params.externalReference?.startsWith('alusa:standalone-subscription:')) return 'SUBSCRIPTION';
  if (params.externalReference?.startsWith('alusa:installment:') || params.externalReference?.startsWith('installmentPlan:')) return 'INSTALLMENT';
  return 'ONE_TIME';
}

function inferGroupId(params: { standaloneInstallmentPlanId?: string | null; externalReference?: string | null }): string | null {
  if (params.standaloneInstallmentPlanId) return params.standaloneInstallmentPlanId;
  if (!params.externalReference) return null;
  const parsed = parseExternalReference(params.externalReference);
  if (parsed?.ids.installmentPlanId) return parsed.ids.installmentPlanId;
  return null;
}

function resolveGroupId(params: {
  familyGroupId?: string | null;
  standaloneInstallmentPlanGroupId?: string | null;
  standaloneSubscriptionGroupId?: string | null;
  matriculaFamiliarId?: string | null;
  standaloneInstallmentPlanId?: string | null;
  externalReference?: string | null;
}): string | null {
  return (
    params.familyGroupId ??
    params.standaloneInstallmentPlanGroupId ??
    params.standaloneSubscriptionGroupId ??
    params.matriculaFamiliarId ??
    inferGroupId({
      standaloneInstallmentPlanId: params.standaloneInstallmentPlanId,
      externalReference: params.externalReference,
    })
  );
}

function inferLinkStatus(asaasPaymentId: string | null): LinkStatus {
  return asaasPaymentId ? 'LINKED' : 'NEEDS_REVIEW';
}

function statusFromCharge(status: ChargeStatus): string {
  return normalizeChargeStatus(status);
}

function statusFromCobranca(status: StatusCobranca): string {
  return normalizeCobrancaStatus(status);
}

function projectionId(sourceKind: 'CHARGE' | 'COBRANCA', sourceId: string): string {
  return `crm:${sourceKind}:${sourceId}`;
}

export async function projectChargeReadModelByChargeId(chargeId: string): Promise<void> {
  if (!readModelEnabled()) return;

  const charge = await prisma.charge.findUnique({
    where: { id: chargeId },
    include: {
      cobranca: {
        include: {
          matricula: {
            include: {
              aluno: { select: { id: true, nome: true } },
              responsavelFinanceiro: { select: { nome: true } },
            },
          },
        },
      },
      standaloneInstallmentPlan: { select: { familyGroupId: true } },
      standaloneSubscription: { select: { familyGroupId: true } },
    },
  });

  if (!charge) return;

  const origin = charge.cobrancaId ? 'ACADEMIC' : 'STANDALONE';
  const payerName =
    charge.payerName ??
    charge.cobranca?.matricula.responsavelFinanceiro?.nome ??
    charge.cobranca?.matricula.aluno.nome ??
    'Cliente';
  const value = charge.value != null ? Number(charge.value) : Number(charge.cobranca?.valor ?? 0);
  const dueDate = charge.dueDate ?? charge.cobranca?.vencimento ?? null;
  const billingType = charge.billingType ?? charge.cobranca?.formaPagamento ?? null;
  const chargeType = inferChargeType({
    standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
    externalReference: charge.externalReference,
    cobrancaTipo: charge.cobranca?.tipo ?? null,
  });
  const groupId = resolveGroupId({
    familyGroupId: charge.familyGroupId,
    standaloneInstallmentPlanGroupId: charge.standaloneInstallmentPlan?.familyGroupId ?? null,
    standaloneSubscriptionGroupId: charge.standaloneSubscription?.familyGroupId ?? null,
    matriculaFamiliarId: charge.cobranca?.matricula.matriculaFamiliarId ?? null,
    standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
    externalReference: charge.externalReference,
  });

  await prisma.chargeReadModel.upsert({
    where: {
      uq_charge_read_model_source: {
        contaId: charge.contaId,
        sourceKind: 'CHARGE',
        sourceId: charge.id,
      },
    },
    update: {
      origin,
      chargeType,
      linkStatus: inferLinkStatus(charge.asaasPaymentId),
      groupId,
      description: charge.description ?? charge.cobranca?.descricao ?? null,
      payerName,
      value,
      dueDate,
      billingType,
      status: statusFromCharge(charge.status),
      asaasPaymentId: charge.asaasPaymentId,
      matriculaId: charge.cobranca?.matriculaId ?? null,
      alunoId: charge.cobranca?.matricula.aluno.id ?? null,
      tipo: charge.cobranca?.tipo ?? (chargeType === 'INSTALLMENT' ? 'PARCELADA' : chargeType === 'SUBSCRIPTION' ? 'RECORRENTE' : 'AVULSA'),
      isGroup: Boolean(groupId),
      installmentCount: null,
      installmentsPaid: null,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
      projectedAt: new Date(),
    },
    create: {
      id: projectionId('CHARGE', charge.id),
      contaId: charge.contaId,
      sourceKind: 'CHARGE',
      sourceId: charge.id,
      origin,
      chargeType,
      linkStatus: inferLinkStatus(charge.asaasPaymentId),
      groupId,
      description: charge.description ?? charge.cobranca?.descricao ?? null,
      payerName,
      value,
      dueDate,
      billingType,
      status: statusFromCharge(charge.status),
      asaasPaymentId: charge.asaasPaymentId,
      matriculaId: charge.cobranca?.matriculaId ?? null,
      alunoId: charge.cobranca?.matricula.aluno.id ?? null,
      tipo: charge.cobranca?.tipo ?? (chargeType === 'INSTALLMENT' ? 'PARCELADA' : chargeType === 'SUBSCRIPTION' ? 'RECORRENTE' : 'AVULSA'),
      isGroup: Boolean(groupId),
      installmentCount: null,
      installmentsPaid: null,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
      projectedAt: new Date(),
    },
  });
}

export async function projectChargeReadModelByCobrancaId(cobrancaId: string): Promise<void> {
  if (!readModelEnabled()) return;

  const cobranca = await prisma.cobranca.findUnique({
    where: { id: cobrancaId },
    include: {
      matricula: {
        include: {
          aluno: { select: { id: true, nome: true, contaId: true } },
          responsavelFinanceiro: { select: { nome: true } },
        },
      },
    },
  });
  if (!cobranca) return;

  const linkedCharge = await prisma.charge.findFirst({
    where: { cobrancaId: cobranca.id },
    select: { id: true, externalReference: true, asaasPaymentId: true, familyGroupId: true },
  });

  const chargeType = inferChargeType({
    externalReference: linkedCharge?.externalReference ?? null,
    cobrancaTipo: cobranca.tipo,
  });

  const contaId = cobranca.matricula.aluno.contaId;
  const groupId = resolveGroupId({
    familyGroupId: linkedCharge?.familyGroupId ?? null,
    matriculaFamiliarId: cobranca.matricula.matriculaFamiliarId ?? null,
    externalReference: linkedCharge?.externalReference ?? null,
  });

  await prisma.chargeReadModel.upsert({
    where: {
      uq_charge_read_model_source: {
        contaId,
        sourceKind: 'COBRANCA',
        sourceId: cobranca.id,
      },
    },
    update: {
      origin: 'ACADEMIC',
      chargeType,
      linkStatus: inferLinkStatus(cobranca.asaasPaymentId ?? linkedCharge?.asaasPaymentId ?? null),
      groupId,
      description: cobranca.descricao ?? cobranca.tipo,
      payerName: cobranca.matricula.responsavelFinanceiro?.nome ?? cobranca.matricula.aluno.nome,
      value: Number(cobranca.valor),
      dueDate: cobranca.vencimento,
      billingType: cobranca.formaPagamento,
      status: statusFromCobranca(cobranca.status),
      asaasPaymentId: cobranca.asaasPaymentId ?? linkedCharge?.asaasPaymentId ?? null,
      matriculaId: cobranca.matriculaId,
      alunoId: cobranca.matricula.aluno.id,
      tipo: cobranca.tipo,
      isGroup: Boolean(groupId),
      installmentCount: null,
      installmentsPaid: null,
      createdAt: cobranca.createdAt,
      updatedAt: cobranca.updatedAt,
      projectedAt: new Date(),
    },
    create: {
      id: projectionId('COBRANCA', cobranca.id),
      contaId,
      sourceKind: 'COBRANCA',
      sourceId: cobranca.id,
      origin: 'ACADEMIC',
      chargeType,
      linkStatus: inferLinkStatus(cobranca.asaasPaymentId ?? linkedCharge?.asaasPaymentId ?? null),
      groupId,
      description: cobranca.descricao ?? cobranca.tipo,
      payerName: cobranca.matricula.responsavelFinanceiro?.nome ?? cobranca.matricula.aluno.nome,
      value: Number(cobranca.valor),
      dueDate: cobranca.vencimento,
      billingType: cobranca.formaPagamento,
      status: statusFromCobranca(cobranca.status),
      asaasPaymentId: cobranca.asaasPaymentId ?? linkedCharge?.asaasPaymentId ?? null,
      matriculaId: cobranca.matriculaId,
      alunoId: cobranca.matricula.aluno.id,
      tipo: cobranca.tipo,
      isGroup: Boolean(groupId),
      installmentCount: null,
      installmentsPaid: null,
      createdAt: cobranca.createdAt,
      updatedAt: cobranca.updatedAt,
      projectedAt: new Date(),
    },
  });
}

export async function backfillChargeReadModel(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ projected: number }> {
  if (!readModelEnabled()) return { projected: 0 };

  const limit = Math.min(Math.max(params?.limit ?? 1000, 1), 10000);
  const charges = await prisma.charge.findMany({
    where: params?.contaId ? { contaId: params.contaId } : undefined,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  for (const charge of charges) {
    await projectChargeReadModelByChargeId(charge.id);
  }

  return { projected: charges.length };
}

export async function listStandaloneChargesFromReadModel(
  input: ListStandaloneChargesInput
): Promise<ListStandaloneChargesOutput> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const statusView = input.statusView ?? 'open';

  const where: Record<string, unknown> = {
    contaId: input.contaId,
    origin: 'STANDALONE',
    chargeType: 'ONE_TIME',
    isGroup: false,
  };

  if (statusView === 'open') {
    where.status = { in: ['PENDING', 'OVERDUE'] };
  } else if (statusView === 'paid') {
    where.status = 'PAID';
  }

  if (input.search) {
    where.OR = [
      { payerName: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.chargeReadModel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.chargeReadModel.count({ where }),
  ]);

  const items: StandaloneChargeItem[] = rows.map((row) => ({
    id: row.sourceId,
    origin: 'STANDALONE',
    description: row.description,
    payerName: row.payerName,
    value: Number(row.value),
    dueDate: row.dueDate?.toISOString() ?? null,
    billingType: row.billingType,
    status: row.status as StandaloneChargeItem['status'],
    chargeType: 'ONE_TIME',
    linkStatus: row.linkStatus as StandaloneChargeItem['linkStatus'],
    groupId: row.groupId,
    asaasPaymentId: row.asaasPaymentId,
    createdAt: row.createdAt.toISOString(),
    invoiceUrl: null,
    isInstallment: false,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export const chargeReadModelService = {
  readModelEnabled,
  projectChargeReadModelByChargeId,
  projectChargeReadModelByCobrancaId,
  backfillChargeReadModel,
  listStandaloneChargesFromReadModel,
};
