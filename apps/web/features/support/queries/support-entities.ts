import prisma from '@/lib/prisma';
import { redactSensitiveJson } from '../shared/format';

export async function getSupportUserDetail(contaId: string, userId: string) {
  return prisma.usuario.findFirst({
    where: { id: userId, contaId },
    select: {
      id: true,
      contaId: true,
      nome: true,
      email: true,
      telefone: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
      acessosConta: {
        where: { contaId },
        select: { role: true, status: true, lastAccessedAt: true, createdAt: true },
        take: 5,
      },
    },
  });
}

export async function getSupportStudentDetail(contaId: string, alunoId: string) {
  return prisma.aluno.findFirst({
    where: { id: alunoId, contaId },
    select: {
      id: true,
      contaId: true,
      nome: true,
      email: true,
      telefone: true,
      cpf: true,
      status: true,
      asaasCustomerId: true,
      asaasCustomerExternalReference: true,
      createdAt: true,
      updatedAt: true,
      responsaveis: {
        select: {
          responsavel: { select: { id: true, nome: true, email: true, telefone: true, financeiro: true } },
        },
        take: 10,
      },
      matriculas: {
        select: {
          id: true,
          status: true,
          statusFinanceiro: true,
          statusContrato: true,
          asaasSubscriptionId: true,
          createdAt: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function getSupportResponsavelDetail(contaId: string, responsavelId: string) {
  return prisma.responsavel.findFirst({
    where: { id: responsavelId, contaId },
    select: {
      id: true,
      contaId: true,
      nome: true,
      email: true,
      telefone: true,
      cpf: true,
      financeiro: true,
      asaasCustomerId: true,
      asaasCustomerExternalReference: true,
      preferredBillingType: true,
      creditCardBrand: true,
      creditCardLast4: true,
      alunos: {
        select: {
          aluno: { select: { id: true, nome: true, status: true } },
          tipoVinculo: true,
        },
        take: 10,
      },
      matriculasFinanceiras: {
        select: { id: true, status: true, statusFinanceiro: true, aluno: { select: { nome: true } } },
        take: 10,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function getSupportEnrollmentDetail(contaId: string, matriculaId: string) {
  return prisma.matricula.findFirst({
    where: { id: matriculaId, contaId },
    select: {
      id: true,
      contaId: true,
      status: true,
      statusFinanceiro: true,
      statusContrato: true,
      dataInicio: true,
      dataFimContrato: true,
      taxaMatricula: true,
      taxaStatus: true,
      formaPagamento: true,
      asaasId: true,
      asaasSubscriptionId: true,
      integrationStatus: true,
      warningCode: true,
      createdAt: true,
      updatedAt: true,
      aluno: { select: { id: true, nome: true, email: true } },
      responsavelFinanceiro: { select: { id: true, nome: true, email: true } },
      cobrancas: {
        select: {
          id: true,
          status: true,
          valor: true,
          vencimento: true,
          asaasPaymentId: true,
          asaasStatus: true,
        },
        take: 20,
        orderBy: { vencimento: 'desc' },
      },
    },
  });
}

export async function getSupportChargeDetail(contaId: string, chargeId: string) {
  const readModel = await prisma.chargeReadModel.findFirst({
    where: {
      contaId,
      OR: [{ id: chargeId }, { sourceId: chargeId }, { asaasPaymentId: chargeId }],
    },
    select: {
      id: true,
      contaId: true,
      sourceKind: true,
      sourceId: true,
      origin: true,
      chargeType: true,
      linkStatus: true,
      payerName: true,
      description: true,
      value: true,
      dueDate: true,
      billingType: true,
      status: true,
      asaasPaymentId: true,
      matriculaId: true,
      alunoId: true,
      installmentCount: true,
      installmentsPaid: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const [webhooks, jobs, localCharge] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where: {
        contaId,
        OR: [
          { asaasPaymentId: readModel?.asaasPaymentId ?? chargeId },
          { eventId: chargeId },
          { id: chargeId },
        ],
      },
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        processadoEm: true,
        ultimoErro: true,
      },
      take: 20,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.asaasIntegrationJob.findMany({
      where: {
        contaId,
        OR: [
          { chargeId: readModel?.sourceKind === 'CHARGE' ? readModel.sourceId : undefined },
          { cobrancaId: readModel?.sourceKind === 'COBRANCA' ? readModel.sourceId : undefined },
        ].filter(Boolean) as { chargeId?: string; cobrancaId?: string }[],
      },
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        doneAt: true,
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
    readModel?.sourceKind === 'COBRANCA'
      ? prisma.cobranca.findFirst({
          where: { id: readModel.sourceId, contaId },
          select: {
            id: true,
            status: true,
            asaasStatus: true,
            valor: true,
            asaasValue: true,
            asaasNetValue: true,
            lastAsaasFetchAt: true,
            liquidacaoStatus: true,
            liquidadoEm: true,
          },
        })
      : null,
  ]);

  return readModel ? { readModel, webhooks, jobs, localCharge } : null;
}

export async function getSupportWebhookDetail(contaId: string, webhookId: string) {
  const webhook = await prisma.webhookAsaas.findFirst({
    where: {
      contaId,
      OR: [{ id: webhookId }, { eventId: webhookId }],
    },
  });

  if (!webhook) return null;

  return {
    ...webhook,
    payload: redactSensitiveJson(webhook.payload),
    attemptsLog: redactSensitiveJson(webhook.attemptsLog),
  };
}

export async function listSupportCases(contaId?: string) {
  const cases = await prisma.supportCase.findMany({
    where: contaId ? { contaId } : undefined,
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  const contaIds = Array.from(new Set(cases.map((item) => item.contaId)));
  const contas = await prisma.conta.findMany({
    where: { id: { in: contaIds } },
    select: { id: true, nome: true },
  });
  const contaNames = new Map(contas.map((item) => [item.id, item.nome]));

  return cases.map((item) => ({
    ...item,
    conta: { nome: contaNames.get(item.contaId) ?? item.contaId },
  }));
}

export async function listSupportNotes(input: { contaId: string; entityType?: string; entityId?: string }) {
  return prisma.supportNote.findMany({
    where: {
      contaId: input.contaId,
      entityType: input.entityType,
      entityId: input.entityId,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
