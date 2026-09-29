import {
  getBalance,
  getExtrato,
  getFinanceiroKpisLocal,
  type ExtratoQueryInput,
} from '@alusa/finance';

import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

export type MobileStatementActor = { userId: string; contaId: string };
export type MobileStatementPeriod = 'THIS_MONTH' | 'LAST_30_DAYS';

export class MobileStatementUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileStatementUnauthorizedError';
  }
}

export class MobileStatementUnavailableError extends Error {
  constructor(message = 'Não foi possível carregar o extrato.') {
    super(message);
    this.name = 'MobileStatementUnavailableError';
  }
}

async function assertActiveMembership(tx: TenantTransactionClient, actor: MobileStatementActor) {
  const membership = await tx.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true, role: true },
  });

  if (!membership || !['ADMIN', 'FINANCEIRO'].includes(membership.role.toUpperCase())) {
    throw new MobileStatementUnauthorizedError();
  }
}

async function assertAuthorizedTenant(actor: MobileStatementActor) {
  await runWithTenant(actor.contaId, async (tx) => {
    await assertActiveMembership(tx, actor);
    const account = await tx.conta.findFirst({
      where: { id: actor.contaId, status: 'ATIVO', deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new MobileStatementUnauthorizedError();
  });
}

function dateInManaus(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function periodDates(period: MobileStatementPeriod) {
  const today = new Date();
  const endDate = dateInManaus(today);

  if (period === 'LAST_30_DAYS') {
    return { startDate: dateInManaus(addDays(today, -29)), endDate };
  }

  const currentDate = dateInManaus(today);
  return {
    startDate: `${currentDate.slice(0, 7)}-01`,
    endDate,
  };
}

function kpiDates() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mesAtual = new Date(now.getFullYear(), now.getMonth(), 1);
  const proximoMes = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const endOfNext30Days = new Date(startOfToday);
  endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
  endOfNext30Days.setHours(23, 59, 59, 999);

  return { mesAtual, proximoMes, startOfToday, endOfNext30Days };
}

export async function getMobileStatement(input: {
  actor: MobileStatementActor;
  period: MobileStatementPeriod;
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
}) {
  await assertAuthorizedTenant(input.actor);

  const dates = periodDates(input.period);
  const query: ExtratoQueryInput = {
    startDate: dates.startDate,
    endDate: dates.endDate,
    page: input.page,
    pageSize: input.pageSize,
    sort: 'date',
    direction: input.direction,
  };
  const kpiInput = kpiDates();

  const [balanceResult, kpis, statement] = await Promise.all([
    getBalance({ contaId: input.actor.contaId }),
    getFinanceiroKpisLocal({ contaId: input.actor.contaId, ...kpiInput }),
    getExtrato({ contaId: input.actor.contaId, query }),
  ]);

  if (!balanceResult.success) {
    throw new MobileStatementUnavailableError('O saldo ainda não está disponível para consulta.');
  }
  if (!statement.success) {
    throw new MobileStatementUnavailableError('Não foi possível carregar as movimentações agora.');
  }

  return {
    summary: {
      available: Number(balanceResult.data.balance),
      awaitingPayment: Number(kpis.data.aguardandoPagamento.valorBruto),
      awaitingSettlement: Number(kpis.data.confirmadas.valorBruto),
    },
    transactions: statement.data.transactions,
    pagination: statement.data.pagination,
    sync: statement.data.sync,
  };
}
