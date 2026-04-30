import { prisma } from '@alusa/database';
import type { InstallmentStatus } from '@prisma/client';
import { buildPaymentReferencePrefix } from '../core';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export type GetInstallmentPlanDetailInput = {
  planId: string;
  contaId: string;
};

export type InstallmentPlanDetailDTO = {
  id: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  cliente: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  valorTotal: number;
  numeroParcelas: number;
  parcelasPagas: number;
  status: StatusParcelamento;
  billingType: string;
  firstDueDate: string;
  matriculaId: string | null;
  contratoId: string | null;
  createdAt: string;
  parcelas: ParcelaItemDTO[];
};

export type ParcelaItemDTO = {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: string;
  dataPagamento: string | null;
  invoiceUrl: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusParcelamento = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

const PAID_STATUSES = new Set(['PAGO', 'PAID']);

function mapChargeStatusToCobranca(status: string): string {
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

function deriveStatus(
  planStatus: string,
  parcelas: Array<{ status: string; vencimento: Date }>,
): StatusParcelamento {
  if (planStatus === 'CANCELED') return 'CANCELADO';
  if (planStatus === 'COMPLETED') return 'QUITADO';

  if (parcelas.length === 0) return 'EM_DIA';

  const allCanceled = parcelas.every((p) => p.status === 'CANCELADO');
  if (allCanceled) return 'CANCELADO';

  const allPaid = parcelas.every((p) => PAID_STATUSES.has(p.status));
  if (allPaid && parcelas.length > 0) return 'QUITADO';

  const now = new Date();
  const hasOverdue = parcelas.some(
    (p) =>
      !PAID_STATUSES.has(p.status) &&
      p.status !== 'CANCELADO' &&
      new Date(p.vencimento) < now,
  );

  return hasOverdue ? 'ATRASADO' : 'EM_DIA';
}

/**
 * Gera parcelas virtuais quando cobranças reais ainda não existem.
 * Isso pode acontecer se o parcelamento foi criado mas a sincronização ainda não rodou.
 */
function generateVirtualInstallments(
  planId: string,
  installmentCount: number,
  firstDueDate: Date,
  valuePerInstallment: number,
): Array<{ id: string; valor: number; vencimento: Date; status: string; dataPagamento: null; invoiceUrl: null }> {
  const now = new Date();
  return Array.from({ length: installmentCount }, (_, i) => {
    const vencimento = new Date(firstDueDate);
    vencimento.setMonth(vencimento.getMonth() + i);
    return {
      id: `virtual-${planId}-${i + 1}`,
      valor: Math.round(valuePerInstallment * 100) / 100,
      vencimento,
      status: vencimento < now ? 'PENDENTE' : 'A_VENCER',
      dataPagamento: null,
      invoiceUrl: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

/**
 * Obtém detalhes de um parcelamento (Academic ou Standalone) com suas parcelas.
 *
 * Lógica:
 * 1. Tenta buscar como InstallmentPlan (acadêmico)
 * 2. Se não encontrar, tenta StandaloneInstallmentPlan
 * 3. Busca cobranças vinculadas e monta parcelas
 * 4. Se não há cobranças reais, gera parcelas virtuais
 */
export async function getInstallmentPlanDetail(
  input: GetInstallmentPlanDetailInput,
  db?: typeof prisma,
): Promise<InstallmentPlanDetailDTO | null> {
  const _db = db ?? prisma;
  const { planId, contaId } = input;

  // -- Tentativa 1: InstallmentPlan (acadêmico) --
  const academicPlan = await _db.installmentPlan.findFirst({
    where: { id: planId, contaId },
    include: {
      matricula: {
        select: {
          id: true,
          aluno: { select: { nome: true, email: true, telefone: true } },
          responsavelFinanceiro: { select: { nome: true, email: true, telefone: true } },
        },
      },
    },
  });

  if (academicPlan) {
    return buildAcademicDetail(academicPlan, contaId, _db);
  }

  // -- Tentativa 2: StandaloneInstallmentPlan --
  const standalonePlan = await _db.standaloneInstallmentPlan.findFirst({
    where: { id: planId, contaId },
    include: {
      customer: { select: { payerType: true, payerId: true } },
    },
  });

  if (standalonePlan) {
    return buildStandaloneDetail(standalonePlan, contaId, _db);
  }

  // -- Tentativa 3: buscar por asaasInstallmentId --
  const byAsaasId = await _db.installmentPlan.findFirst({
    where: { asaasInstallmentId: planId, contaId },
    include: {
      matricula: {
        select: {
          id: true,
          aluno: { select: { nome: true, email: true, telefone: true } },
          responsavelFinanceiro: { select: { nome: true, email: true, telefone: true } },
        },
      },
    },
  });
  if (byAsaasId) {
    return buildAcademicDetail(byAsaasId, contaId, _db);
  }

  const standaloneByAsaasId = await _db.standaloneInstallmentPlan.findFirst({
    where: { asaasInstallmentId: planId, contaId },
    include: {
      customer: { select: { payerType: true, payerId: true } },
    },
  });
  if (standaloneByAsaasId) {
    return buildStandaloneDetail(standaloneByAsaasId, contaId, _db);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Academic detail builder
// ---------------------------------------------------------------------------

async function buildAcademicDetail(
  plan: {
    id: string;
    externalReference: string;
    status: InstallmentStatus;
    installmentCount: number;
    billingType: string;
    value: unknown; // Decimal
    firstDueDate: Date;
    createdAt: Date;
    matriculaId: string;
    contratoId: string | null;
    matricula: {
      id: string;
      aluno: { nome: string; email: string | null; telefone: string | null } | null;
      responsavelFinanceiro: { nome: string; email: string | null; telefone: string | null } | null;
    };
  },
  contaId: string,
  db: typeof prisma,
): Promise<InstallmentPlanDetailDTO> {
  // Buscar charges vinculadas via externalReference prefix
  const charges = await db.charge.findMany({
    where: {
      contaId,
      OR: [
        { externalReference: plan.externalReference },
        { externalReference: { startsWith: buildPaymentReferencePrefix(plan.externalReference) } },
      ],
    },
    orderBy: { dueDate: 'asc' },
    include: {
      cobranca: {
        select: {
          id: true,
          valor: true,
          vencimento: true,
          status: true,
          dataPagamento: true,
          asaasPaymentId: true,
        },
      },
    },
  });

  type ParcelaInfo = {
    id: string;
    valor: number;
    vencimento: Date;
    status: string;
    dataPagamento: Date | null;
    invoiceUrl: string | null;
  };

  const rawParcelas: ParcelaInfo[] = charges
    .filter((c) => c.cobranca)
    .map((c) => ({
      id: c.cobranca!.id,
      valor: Number(c.cobranca!.valor),
      vencimento: c.cobranca!.vencimento,
      status: c.cobranca!.status,
      dataPagamento: c.cobranca!.dataPagamento,
      invoiceUrl: c.cobranca!.asaasPaymentId
        ? `https://sandbox.asaas.com/i/${c.cobranca!.asaasPaymentId.replace('pay_', '')}`
        : null,
    }));

  // Deduplicar por asaasPaymentId (proteção contra duplicatas históricas)
  const seen = new Set<string>();
  let parcelas: ParcelaInfo[] = rawParcelas
    .filter((p) => {
      const key = p.invoiceUrl ?? p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());

  // Mitigação para planos acadêmicos historicamente contaminados:
  // restringe ao ciclo esperado (firstDueDate + quantidade de parcelas).
  if (parcelas.length > plan.installmentCount && plan.installmentCount > 0) {
    const windowStart = new Date(plan.firstDueDate);
    const windowEnd = new Date(plan.firstDueDate);
    windowEnd.setMonth(windowEnd.getMonth() + plan.installmentCount);

    const inCycleWindow = parcelas.filter(
      (p) => p.vencimento >= windowStart && p.vencimento < windowEnd,
    );

    if (inCycleWindow.length > 0) {
      parcelas = inCycleWindow;
    }

    if (parcelas.length > plan.installmentCount) {
      parcelas = parcelas.slice(0, plan.installmentCount);
    }
  }

  // Gerar parcelas virtuais se nenhuma cobrança real existe
  if (parcelas.length === 0 && plan.installmentCount > 0) {
    const valorParcela = Number(plan.value);
    parcelas = generateVirtualInstallments(plan.id, plan.installmentCount, plan.firstDueDate, valorParcela);
  }

  const parcelasPagas = Math.min(
    parcelas.filter((p) => PAID_STATUSES.has(p.status)).length,
    plan.installmentCount,
  );
  const valorTotal = parcelas.reduce((acc, p) => acc + p.valor, 0);

  const clienteNome =
    plan.matricula.aluno?.nome ??
    plan.matricula.responsavelFinanceiro?.nome ??
    'Cliente';
  const clienteEmail =
    plan.matricula.aluno?.email ??
    plan.matricula.responsavelFinanceiro?.email ??
    undefined;
  const clienteTelefone =
    plan.matricula.aluno?.telefone ??
    plan.matricula.responsavelFinanceiro?.telefone ??
    undefined;

  const statusDerived = deriveStatus(
    plan.status,
    parcelas.map((p) => ({ status: p.status, vencimento: p.vencimento })),
  );

  return {
    id: plan.id,
    origin: 'ACADEMIC',
    cliente: clienteNome,
    clienteEmail,
    clienteTelefone,
    valorTotal,
    numeroParcelas: plan.installmentCount,
    parcelasPagas,
    status: statusDerived,
    billingType: plan.billingType,
    firstDueDate: plan.firstDueDate.toISOString(),
    matriculaId: plan.matriculaId,
    contratoId: plan.contratoId,
    createdAt: plan.createdAt.toISOString(),
    parcelas: parcelas.map((p, idx) => ({
      id: p.id,
      numero: idx + 1,
      valor: p.valor,
      vencimento: p.vencimento.toISOString(),
      status: p.status,
      dataPagamento: p.dataPagamento?.toISOString() ?? null,
      invoiceUrl: p.invoiceUrl,
    })),
  };
}

// ---------------------------------------------------------------------------
// Standalone detail builder
// ---------------------------------------------------------------------------

async function buildStandaloneDetail(
  plan: {
    id: string;
    status: InstallmentStatus;
    installmentCount: number;
    billingType: string;
    value: unknown; // Decimal
    firstDueDate: Date;
    createdAt: Date;
    asaasInstallmentId: string | null;
    customer: { payerType: string; payerId: string };
  },
  contaId: string,
  db: typeof prisma,
): Promise<InstallmentPlanDetailDTO> {
  // Buscar charges vinculadas via FK
  const charges = await db.charge.findMany({
    where: {
      contaId,
      standaloneInstallmentPlanId: plan.id,
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      payerName: true,
      value: true,
      dueDate: true,
      status: true,
      invoiceUrl: true,
    },
  });

  type ParcelaInfo = {
    id: string;
    valor: number;
    vencimento: Date;
    status: string;
    dataPagamento: Date | null;
    invoiceUrl: string | null;
  };

  let parcelas: ParcelaInfo[] = charges
    .map((c) => ({
      id: c.id,
      valor: c.value ? Number(c.value) : 0,
      vencimento: c.dueDate ?? plan.firstDueDate,
      status: mapChargeStatusToCobranca(c.status),
      dataPagamento: null,
      invoiceUrl: c.invoiceUrl ?? null,
    }))
    .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());

  // Gerar parcelas virtuais se nenhuma cobrança real existe
  if (parcelas.length === 0 && plan.installmentCount > 0) {
    const perInstallment = Number(plan.value) / plan.installmentCount;
    parcelas = generateVirtualInstallments(plan.id, plan.installmentCount, plan.firstDueDate, perInstallment);
  }

  const parcelasPagas = Math.min(
    parcelas.filter((p) => PAID_STATUSES.has(p.status)).length,
    plan.installmentCount,
  );
  const valorTotal = parcelas.reduce((acc, p) => acc + p.valor, 0);

  // Resolver nome do pagador
  const customerInfo = await resolveCustomerName(plan.customer, contaId, db);
  const displayName = charges.find((charge) => charge.payerName && charge.payerName.trim().length > 0)?.payerName ?? null;

  const statusDerived = deriveStatus(
    plan.status,
    parcelas.map((p) => ({ status: p.status, vencimento: p.vencimento })),
  );

  return {
    id: plan.id,
    origin: 'STANDALONE',
    cliente: displayName ?? customerInfo.nome,
    clienteEmail: customerInfo.email,
    clienteTelefone: customerInfo.telefone,
    valorTotal,
    numeroParcelas: plan.installmentCount,
    parcelasPagas,
    status: statusDerived,
    billingType: plan.billingType,
    firstDueDate: plan.firstDueDate.toISOString(),
    matriculaId: null,
    contratoId: null,
    createdAt: plan.createdAt.toISOString(),
    parcelas: parcelas.map((p, idx) => ({
      id: p.id,
      numero: idx + 1,
      valor: p.valor,
      vencimento: p.vencimento.toISOString(),
      status: p.status,
      dataPagamento: p.dataPagamento?.toISOString() ?? null,
      invoiceUrl: p.invoiceUrl,
    })),
  };
}

// ---------------------------------------------------------------------------
// Resolução de nome do pagador
// ---------------------------------------------------------------------------

async function resolveCustomerName(
  customer: { payerType: string; payerId: string },
  contaId: string,
  db: typeof prisma,
): Promise<{ nome: string; email?: string; telefone?: string }> {
  if (customer.payerType === 'RESPONSAVEL') {
    const resp = await db.responsavel.findFirst({
      where: { id: customer.payerId, contaId },
      select: { nome: true, email: true, telefone: true },
    });
    return {
      nome: resp?.nome ?? 'Cliente',
      email: resp?.email ?? undefined,
      telefone: resp?.telefone ?? undefined,
    };
  }

  const aluno = await db.aluno.findFirst({
    where: { id: customer.payerId, contaId },
    select: { nome: true, email: true, telefone: true },
  });
  return {
    nome: aluno?.nome ?? 'Cliente',
    email: aluno?.email ?? undefined,
    telefone: aluno?.telefone ?? undefined,
  };
}
