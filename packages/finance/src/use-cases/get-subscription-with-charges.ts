/**
 * Get Subscription with Charges
 *
 * Retorna detalhes de uma assinatura com suas cobranças vinculadas
 * usando vínculo determinístico via externalReference.
 *
 * FASE 4: Cobranças são buscadas SOMENTE pelo vínculo externalReference,
 * nunca por matrícula "solta" (evita misturar cobranças de assinaturas diferentes).
 */

import { prisma } from '@alusa/database';
import type { SubscriptionStatus, StatusCobranca, ChargeStatus } from '@prisma/client';
import { buildPaymentReferencePrefix } from '../core';

type StandaloneSubscriptionFindFirstArgs = {
  where: { id: string; contaId: string };
  select: {
    id: true;
    asaasSubscriptionId: true;
    externalReference: true;
    status: true;
    cycle: true;
    billingType: true;
    value: true;
    nextDueDate: true;
    endDate: true;
    description: true;
    customerId: true;
    createdAt: true;
  };
};

function getStandaloneSubscriptionDelegate() {
  return (prisma as unknown as {
    standaloneSubscription?: {
      findFirst: (_args: StandaloneSubscriptionFindFirstArgs) => Promise<{
        id: string;
        asaasSubscriptionId: string | null;
        externalReference: string;
        status: SubscriptionStatus;
        cycle: string;
        billingType: string;
        value: number | { toString(): string };
        nextDueDate: Date | null;
        endDate: Date | null;
        description: string | null;
        customerId: string;
        createdAt: Date;
      } | null>;
    };
  }).standaloneSubscription;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface GetSubscriptionWithChargesInput {
  contaId: string;
  subscriptionId: string;
}

export interface SubscriptionChargeDTO {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: string;
  dataPagamento: string | null;
  asaasPaymentId: string | null;
  source: 'CHARGE' | 'COBRANCA';
}

export interface SubscriptionDetailsDTO {
  id: string;
  asaasSubscriptionId: string | null;
  externalReference: string;
  status: SubscriptionStatus;
  statusLabel: string;
  clienteNome: string;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  alunoNome: string;
  alunoId: string;
  valor: number;
  cycle: string;
  cycleLabel: string;
  billingType: string;
  description: string | null;
  nextDueDate: string | null;
  matriculaId: string;
  contratoId: string;
  createdAt: string;
  cobrancas: SubscriptionChargeDTO[];
  totalCobrancas: number;
  cobrancasPagas: number;
  valorRecebido: number;
}

export type GetSubscriptionWithChargesOutput =
  | { success: true; data: SubscriptionDetailsDTO }
  | { success: false; error: string };

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CYCLE_LABELS: Record<string, string> = {
  MENSAL: 'Mensal',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
};

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  REQUESTED: 'Solicitada',
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  EXPIRED: 'Expirada',
  DELETED: 'Excluída',
  FAILED: 'Falhou',
};

// Mapeamento de status para contagem de "pagas"
const PAID_STATUSES: Set<StatusCobranca | ChargeStatus | string> = new Set([
  'PAGO',
  'PAID',
]);

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function calcularIdade(dataNasc: Date | null): number {
  if (!dataNasc) return 0;
  const hoje = new Date();
  let idade = hoje.getFullYear() - dataNasc.getFullYear();
  const m = hoje.getMonth() - dataNasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < dataNasc.getDate())) {
    idade--;
  }
  return idade;
}

function normalizeChargeStatus(status: ChargeStatus): string {
  switch (status) {
    case 'CREATED':
    case 'OPEN':
      return 'PENDENTE';
    case 'PAID':
      return 'PAGO';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    default:
      return status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toDateOnlyTimestamp(value: Date | string): number {
  const parsed = value instanceof Date ? value : new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function getSubscriptionWithCharges(
  input: GetSubscriptionWithChargesInput
): Promise<GetSubscriptionWithChargesOutput> {
  const { contaId, subscriptionId } = input;

  // Buscar a Subscription
  const sub = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      contaId,
    },
    include: {
      matricula: {
        select: {
          id: true,
          vencimentoDia: true,
          formaPagamento: true,
          formaPagamentoTaxa: true,
          aluno: {
            select: { id: true, nome: true, email: true, telefone: true, dataNasc: true },
          },
          responsavelFinanceiro: {
            select: { id: true, nome: true, email: true, telefone: true },
          },
          plano: {
            select: { nome: true, valor: true, periodicidade: true, descricao: true },
          },
          combo: {
            select: { nome: true, valor: true },
          },
        },
      },
    },
  });

  if (!sub) {
    // Buscar na tabela StandaloneSubscription
    const standaloneSubscriptionDelegate = getStandaloneSubscriptionDelegate();
    const standaloneSub = standaloneSubscriptionDelegate
      ? await standaloneSubscriptionDelegate.findFirst({
          where: { id: subscriptionId, contaId },
          select: {
            id: true,
            asaasSubscriptionId: true,
            externalReference: true,
            status: true,
            cycle: true,
            billingType: true,
            value: true,
            nextDueDate: true,
            endDate: true,
            description: true,
            customerId: true,
            createdAt: true,
          },
        })
      : null;

    if (standaloneSub) {
      const charges = await prisma.charge.findMany({
        where: {
          contaId,
          OR: [
            { standaloneSubscriptionId: standaloneSub.id },
            { externalReference: standaloneSub.externalReference },
            { externalReference: { startsWith: buildPaymentReferencePrefix(standaloneSub.externalReference) } },
          ],
        },
        orderBy: { dueDate: 'desc' },
        select: {
          id: true,
          status: true,
          value: true,
          dueDate: true,
          asaasPaymentId: true,
        },
      });

      const cobrancas: SubscriptionChargeDTO[] = charges
        .map((charge, idx) => ({
          id: charge.id,
          numero: charges.length - idx,
          valor: charge.value != null ? Number(charge.value) : 0,
          vencimento: charge.dueDate?.toISOString() ?? '',
          status: normalizeChargeStatus(charge.status),
          dataPagamento: null,
          asaasPaymentId: charge.asaasPaymentId,
          source: 'CHARGE' as const,
        }))
        .filter((c) => c.vencimento);

      const cobrancasPagas = cobrancas.filter((c) => PAID_STATUSES.has(c.status)).length;
      const valorRecebido = cobrancas
        .filter((c) => PAID_STATUSES.has(c.status))
        .reduce((acc, c) => acc + c.valor, 0);

      const statusLabel = STATUS_LABELS[standaloneSub.status] ?? standaloneSub.status;
      const cycleLabel = CYCLE_LABELS[standaloneSub.cycle] ?? standaloneSub.cycle;

      const data: SubscriptionDetailsDTO = {
        id: standaloneSub.id,
        asaasSubscriptionId: standaloneSub.asaasSubscriptionId,
        externalReference: standaloneSub.externalReference,
        status: standaloneSub.status,
        statusLabel,
        clienteNome: 'Cliente',
        clienteEmail: null,
        clienteTelefone: null,
        alunoNome: 'Cliente',
        alunoId: standaloneSub.customerId,
        valor: Number(standaloneSub.value),
        cycle: standaloneSub.cycle,
        cycleLabel,
        billingType: standaloneSub.billingType,
        description: standaloneSub.description,
        nextDueDate: standaloneSub.nextDueDate?.toISOString().split('T')[0] ?? null,
        matriculaId: '',
        contratoId: '',
        createdAt: standaloneSub.createdAt.toISOString(),
        cobrancas,
        totalCobrancas: cobrancas.length,
        cobrancasPagas,
        valorRecebido,
      };

      return { success: true, data };
    }

    // Fallback legado: buscar no auditLog
    const manualLog = await prisma.auditLog.findFirst({
      where: {
        contaId,
        action: 'finance.standalone_subscription.created',
        entityType: 'StandaloneSubscription',
        entityId: subscriptionId,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (!manualLog || !manualLog.entityId) {
      return { success: false, error: 'Assinatura não encontrada' };
    }

    const metadata = asRecord(manualLog.metadata);
    if (!metadata) {
      return { success: false, error: 'Assinatura manual sem metadados válidos' };
    }

    const externalReference =
      typeof metadata.externalReference === 'string' ? metadata.externalReference : null;
    if (!externalReference) {
      return { success: false, error: 'Assinatura manual sem externalReference' };
    }

    const charges = await prisma.charge.findMany({
      where: {
        contaId,
        OR: [
          { externalReference },
          { externalReference: { startsWith: buildPaymentReferencePrefix(externalReference) } },
        ],
      },
      orderBy: { dueDate: 'desc' },
      select: {
        id: true,
        status: true,
        value: true,
        dueDate: true,
        asaasPaymentId: true,
      },
    });

    const cobrancasManuais: SubscriptionChargeDTO[] = charges
      .map((charge, idx) => ({
        id: charge.id,
        numero: charges.length - idx,
        valor: charge.value != null ? Number(charge.value) : 0,
        vencimento: charge.dueDate?.toISOString() ?? '',
        status: normalizeChargeStatus(charge.status),
        dataPagamento: null,
        asaasPaymentId: charge.asaasPaymentId,
        source: 'CHARGE' as const,
      }))
      .filter((c) => c.vencimento);

    const cobrancasPagas = cobrancasManuais.filter((c) => PAID_STATUSES.has(c.status)).length;
    const valorRecebido = cobrancasManuais
      .filter((c) => PAID_STATUSES.has(c.status))
      .reduce((acc, c) => acc + c.valor, 0);

    const rawStatus = metadata.status;
    const status: SubscriptionStatus =
      rawStatus === 'REQUESTED' ||
      rawStatus === 'ACTIVE' ||
      rawStatus === 'INACTIVE' ||
      rawStatus === 'EXPIRED' ||
      rawStatus === 'DELETED' ||
      rawStatus === 'FAILED'
        ? rawStatus
        : 'REQUESTED';

    const rawValue = metadata.value;
    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number(rawValue)
          : 0;
    const cycle = typeof metadata.cycle === 'string' ? metadata.cycle : 'MONTHLY';
    const nextDueDate =
      typeof metadata.nextDueDate === 'string' && metadata.nextDueDate.length > 0
        ? metadata.nextDueDate
        : null;
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : null;
    const payerName =
      typeof metadata.payerName === 'string' && metadata.payerName.trim().length > 0
        ? metadata.payerName
        : 'Cliente';
    const payerId =
      typeof metadata.payerId === 'string' && metadata.payerId.length > 0
        ? metadata.payerId
        : manualLog.entityId;

    const manualData: SubscriptionDetailsDTO = {
      id: manualLog.entityId,
      asaasSubscriptionId:
        typeof metadata.asaasSubscriptionId === 'string' ? metadata.asaasSubscriptionId : null,
      externalReference,
      status,
      statusLabel: STATUS_LABELS[status] ?? status,
      clienteNome: payerName,
      clienteEmail: null,
      clienteTelefone: null,
      alunoNome: payerName,
      alunoId: payerId,
      valor: Number.isFinite(value) ? value : 0,
      cycle,
      cycleLabel: CYCLE_LABELS[cycle] ?? cycle,
      billingType: typeof metadata.billingType === 'string' ? metadata.billingType : 'BOLETO',
      description,
      nextDueDate,
      matriculaId: '',
      contratoId: '',
      createdAt: manualLog.createdAt.toISOString(),
      cobrancas: cobrancasManuais,
      totalCobrancas: cobrancasManuais.length,
      cobrancasPagas,
      valorRecebido,
    };

    return { success: true, data: manualData };
  }

  const matricula = sub.matricula;
  const aluno = matricula.aluno;
  const responsavel = matricula.responsavelFinanceiro;
  const plano = matricula.plano;
  const combo = matricula.combo;

  // Determinar pagador
  const idade = calcularIdade(aluno.dataNasc);
  const isMenor = idade < 18;
  const clienteNome = isMenor
    ? responsavel?.nome ?? 'Sem responsável vinculado'
    : aluno.nome;
  const clienteEmail = isMenor
    ? responsavel?.email ?? aluno.email ?? null
    : aluno.email ?? null;
  const clienteTelefone = isMenor
    ? responsavel?.telefone ?? aluno.telefone ?? null
    : aluno.telefone ?? null;

  // Valor e periodicidade
  const valor = plano?.valor ?? combo?.valor ?? 0;
  const periodicidade = plano?.periodicidade ?? 'MENSAL';
  const cycleLabel = CYCLE_LABELS[periodicidade] ?? periodicidade;
  const description = plano?.descricao ?? plano?.nome ?? combo?.nome ?? null;
  const billingType = matricula.formaPagamento ?? matricula.formaPagamentoTaxa ?? 'BOLETO';

  // ══════════════════════════════════════════════════════════════════════════
  // BUSCAR COBRANÇAS VIA MÚLTIPLAS ESTRATÉGIAS
  // 1. Via externalReference na tabela Charge
  // 2. Via Cobranca.tipo = MENSALIDADE na matrícula da assinatura
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Buscar Charges (standalone ou vinculados) pela externalReference
  const charges = await prisma.charge.findMany({
    where: {
      contaId,
      OR: [
        { externalReference: sub.externalReference },
        { externalReference: { startsWith: buildPaymentReferencePrefix(sub.externalReference) } },
      ],
    },
    orderBy: { dueDate: 'desc' },
    select: {
      id: true,
      status: true,
      value: true,
      dueDate: true,
      asaasPaymentId: true,
      cobranca: {
        select: {
          id: true,
          status: true,
          valor: true,
          vencimento: true,
          dataPagamento: true,
          asaasPaymentId: true,
        },
      },
    },
  });

  // 2. Buscar Cobranças MENSALIDADE diretamente na matrícula da assinatura
  // (Para assinaturas que geraram cobranças antes da tabela Charge existir)
  const cobrancasMensalidade = await prisma.cobranca.findMany({
    where: {
      matriculaId: sub.matriculaId,
      tipo: 'MENSALIDADE',
    },
    orderBy: { vencimento: 'desc' },
    select: {
      id: true,
      status: true,
      valor: true,
      vencimento: true,
      dataPagamento: true,
      asaasPaymentId: true,
    },
  });

  // Coletar IDs de cobranças já incluídas via Charge para evitar duplicatas
  const includedCobrancaIds = new Set<string>();
  
  // Normalizar Charges para DTO unificado
  const cobrancasFromCharges: SubscriptionChargeDTO[] = charges.map((charge) => {
    // Se tem Cobranca vinculada, usar dados dela (mais ricos)
    if (charge.cobranca) {
      const c = charge.cobranca;
      includedCobrancaIds.add(c.id);
      return {
        id: c.id,
        numero: 0, // Será recalculado após merge
        valor: Number(c.valor),
        vencimento: c.vencimento.toISOString(),
        status: c.status,
        dataPagamento: c.dataPagamento?.toISOString() ?? null,
        asaasPaymentId: c.asaasPaymentId ?? charge.asaasPaymentId,
        source: 'COBRANCA' as const,
      };
    }

    // Senão, usar dados do Charge (standalone ou não sincronizado)
    return {
      id: charge.id,
      numero: 0, // Será recalculado após merge
      valor: charge.value != null ? Number(charge.value) : 0,
      vencimento: charge.dueDate?.toISOString() ?? '',
      status: normalizeChargeStatus(charge.status),
      dataPagamento: null,
      asaasPaymentId: charge.asaasPaymentId,
      source: 'CHARGE' as const,
    };
  });

  // Adicionar cobranças MENSALIDADE que não estão nos Charges
  const cobrancasFromMensalidade: SubscriptionChargeDTO[] = cobrancasMensalidade
    .filter((c) => !includedCobrancaIds.has(c.id))
    .map((c) => ({
      id: c.id,
      numero: 0, // Será recalculado após merge
      valor: Number(c.valor),
      vencimento: c.vencimento.toISOString(),
      status: c.status,
      dataPagamento: c.dataPagamento?.toISOString() ?? null,
      asaasPaymentId: c.asaasPaymentId,
      source: 'COBRANCA' as const,
    }));

  // Merge e ordenar por vencimento decrescente
  const allCobrancas = [...cobrancasFromCharges, ...cobrancasFromMensalidade]
    .sort((a, b) => new Date(b.vencimento).getTime() - new Date(a.vencimento).getTime());

  // Recalcular números sequenciais
  const cobrancas = allCobrancas.map((c, idx) => ({
    ...c,
    numero: allCobrancas.length - idx,
  }));

  // Próximo vencimento
  const hoje = new Date();
  const hojeDateOnly = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const proxima = cobrancas.find(
    (c) =>
      ['PENDENTE', 'A_VENCER'].includes(c.status) &&
      toDateOnlyTimestamp(c.vencimento) >= hojeDateOnly.getTime()
  );
  let nextDueDate: string | null = proxima?.vencimento ?? null;

  if (!nextDueDate && sub.status === 'ACTIVE') {
    const diaVenc = matricula.vencimentoDia ?? 5;
    const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, diaVenc);
    nextDueDate = proximoMes.toISOString();
  }

  // Estatísticas
  const cobrancasPagas = cobrancas.filter((c) =>
    PAID_STATUSES.has(c.status)
  ).length;
  const valorRecebido = cobrancas
    .filter((c) => PAID_STATUSES.has(c.status))
    .reduce((acc, c) => acc + c.valor, 0);
  const valorOficial = proxima?.valor ?? allCobrancas[0]?.valor ?? Number(valor);

  const data: SubscriptionDetailsDTO = {
    id: sub.id,
    asaasSubscriptionId: sub.asaasSubscriptionId,
    externalReference: sub.externalReference,
    status: sub.status,
    statusLabel: STATUS_LABELS[sub.status] ?? sub.status,
    clienteNome,
    clienteEmail,
    clienteTelefone,
    alunoNome: aluno.nome,
    alunoId: aluno.id,
    valor: Number(valorOficial),
    cycle: periodicidade,
    cycleLabel,
    billingType,
    description,
    nextDueDate,
    matriculaId: matricula.id,
    contratoId: sub.contratoId ?? '',
    createdAt: sub.createdAt.toISOString(),
    cobrancas,
    totalCobrancas: cobrancas.length,
    cobrancasPagas,
    valorRecebido,
  };

  return { success: true, data };
}
