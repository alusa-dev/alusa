import { NextResponse } from 'next/server';
import { FamilyBillingStatus, SubscriptionStatus } from '@prisma/client';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function normalizePayment(value: string | null) {
  if (value === 'PIX' || value === 'BOLETO' || value === 'CARTAO_CREDITO') return value;
  if (value === 'CARTAO') return 'CARTAO_CREDITO';
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado.');
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuario nao tem permissao para consultar cobranca.');
  }

  const url = new URL(request.url);
  const contaId = url.searchParams.get('contaId')?.trim() || user.contaId;
  if (contaId !== user.contaId) {
    return jsonError(403, 'CONTA_INVALIDA', 'Conta informada nao pertence ao usuario.');
  }

  const legacyResponsavelId = url.searchParams.get('responsavelId')?.trim();
  const payerTypeParam = url.searchParams.get('payerType')?.trim().toUpperCase();
  const payerType =
    payerTypeParam === 'ALUNO' || payerTypeParam === 'RESPONSAVEL'
      ? payerTypeParam
      : legacyResponsavelId
        ? 'RESPONSAVEL'
        : null;
  const payerId = url.searchParams.get('payerId')?.trim() || legacyResponsavelId;
  if (!payerType || !payerId) {
    return jsonError(400, 'PAGADOR_OBRIGATORIO', 'Informe o pagador para consultar cobrancas.');
  }

  const formaPagamento = normalizePayment(url.searchParams.get('formaPagamento'));
  const vencimentoDiaRaw = Number(url.searchParams.get('vencimentoDia') ?? 0);
  const vencimentoDia =
    Number.isInteger(vencimentoDiaRaw) && vencimentoDiaRaw >= 1 && vencimentoDiaRaw <= 28
      ? vencimentoDiaRaw
      : null;

  const [familyGroups, subscriptions] = await Promise.all([
    payerType === 'RESPONSAVEL'
      ? prisma.matriculaFamiliar.findMany({
          where: {
            contaId,
            responsavelId: payerId,
            status: {
              in: [
                FamilyBillingStatus.PENDENTE,
                FamilyBillingStatus.PROCESSANDO,
                FamilyBillingStatus.ATIVO,
                FamilyBillingStatus.PARCIAL,
              ],
            },
          },
          orderBy: [{ updatedAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            status: true,
            totalAlunos: true,
            valorMensalidadeTotal: true,
            formaPagamento: true,
            diaVencimento: true,
            ciclo: true,
            dataInicio: true,
            dataFimContrato: true,
            updatedAt: true,
            items: {
              select: {
                matricula: {
                  select: {
                    id: true,
                    aluno: { select: { id: true, nome: true } },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.subscription.findMany({
      where: {
        contaId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.REQUESTED] },
        asaasSubscriptionId: { not: null },
        matricula:
          payerType === 'RESPONSAVEL'
            ? { contaId, responsavelFinanceiroId: payerId }
            : { contaId, alunoId: payerId, responsavelFinanceiroId: null },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        matricula: {
          select: {
            id: true,
            formaPagamento: true,
            vencimentoDia: true,
            dataInicio: true,
            dataFimContrato: true,
            aluno: { select: { id: true, nome: true } },
            plano: { select: { nome: true, valor: true, periodicidade: true } },
            combo: { select: { nome: true, valor: true, periodicidade: true } },
          },
        },
      },
    }),
  ]);

  const familyOptions = familyGroups.map((group) => {
    const blockers: string[] = [];
    if (formaPagamento && group.formaPagamento && group.formaPagamento !== formaPagamento) {
      blockers.push('Forma de pagamento diferente.');
    }
    if (vencimentoDia && group.diaVencimento && group.diaVencimento !== vencimentoDia) {
      blockers.push('Dia de vencimento diferente.');
    }

    return {
      id: `family:${group.id}`,
      label: `Cobranca de ${group.items.length || group.totalAlunos} matricula(s)`,
      type: 'FAMILY_GROUP',
      status: group.status,
      compatible: blockers.length === 0,
      blockers,
      totalAlunos: group.totalAlunos,
      valorMensalidadeTotal: Number(group.valorMensalidadeTotal),
      formaPagamento: group.formaPagamento,
      vencimentoDia: group.diaVencimento,
      ciclo: group.ciclo,
      dataInicio: group.dataInicio?.toISOString() ?? null,
      dataFimContrato: group.dataFimContrato?.toISOString() ?? null,
      alunos: group.items.map((item) => ({
        matriculaId: item.matricula.id,
        alunoId: item.matricula.aluno.id,
        nome: item.matricula.aluno.nome,
      })),
      updatedAt: group.updatedAt.toISOString(),
    };
  });

  const subscriptionOptions = subscriptions.map((subscription) => {
    const blockers: string[] = [];
    if (formaPagamento && subscription.matricula.formaPagamento !== formaPagamento) {
      blockers.push('Forma de pagamento diferente.');
    }
    if (vencimentoDia && subscription.matricula.vencimentoDia !== vencimentoDia) {
      blockers.push('Dia de vencimento diferente.');
    }

    return {
      id: `subscription:${subscription.id}`,
      label: `Assinatura de ${subscription.matricula.aluno.nome}`,
      type: 'SUBSCRIPTION',
      status: subscription.status,
      compatible: blockers.length === 0,
      blockers,
      totalAlunos: 1,
      valorMensalidadeTotal: Number(
        subscription.matricula.combo?.valor ?? subscription.matricula.plano?.valor ?? 0,
      ),
      formaPagamento: subscription.matricula.formaPagamento,
      vencimentoDia: subscription.matricula.vencimentoDia,
      ciclo:
        subscription.matricula.combo?.periodicidade ??
        subscription.matricula.plano?.periodicidade ??
        null,
      dataInicio: subscription.matricula.dataInicio?.toISOString() ?? null,
      dataFimContrato: subscription.matricula.dataFimContrato?.toISOString() ?? null,
      alunos: [
        {
          matriculaId: subscription.matricula.id,
          alunoId: subscription.matricula.aluno.id,
          nome: subscription.matricula.aluno.nome,
        },
      ],
      updatedAt: subscription.updatedAt.toISOString(),
    };
  });

  return NextResponse.json(
    { data: [...familyOptions, ...subscriptionOptions] },
    { headers: { 'cache-control': 'no-store' } },
  );
}
