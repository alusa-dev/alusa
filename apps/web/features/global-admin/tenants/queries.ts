import { prisma } from '@alusa/database';
import { getWebhookOperationalDiagnostics } from '@alusa/finance';

import { listGlobalAdminAudit } from '../audit/queries';
import { mapGlobalAdminTenant360ToDTO } from './mappers';

const REMOTE_PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const LOCAL_FINAL_STATUSES = ['PAGO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toNullableNumber(value: unknown) {
  if (value == null) return null;
  return Number(value);
}

export async function getGlobalAdminTenant360(contaId: string, windowDays = 7) {
  const [tenant, diagnostics, latestEvents, divergentCharges, auditPreview] = await Promise.all([
    prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        id: true,
        nome: true,
        financeStatus: true,
        createdAt: true,
        financeProfile: {
          select: {
            id: true,
            asaasAccount: {
              select: {
                asaasAccountId: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    getWebhookOperationalDiagnostics({ contaId, includeGaps: true, windowDays }),
    prisma.webhookAsaas.findMany({
      where: { contaId },
      orderBy: { recebidoEm: 'desc' },
      take: 10,
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        tentativas: true,
        recebidoEm: true,
        processadoEm: true,
        ultimoErro: true,
        asaasPaymentId: true,
      },
    }),
    prisma.cobranca.findMany({
      where: {
        matricula: { aluno: { contaId } },
        OR: [
          {
            status: { notIn: LOCAL_FINAL_STATUSES as never[] },
            asaasStatus: { in: REMOTE_PAID_STATUSES },
          },
          {
            status: 'PAGO',
            asaasStatus: { in: ['PENDING', 'OVERDUE', 'DELETED'] },
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        descricao: true,
        status: true,
        asaasStatus: true,
        asaasPaymentId: true,
        valor: true,
        updatedAt: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    }),
    listGlobalAdminAudit({ tenantId: contaId, limit: 10 }),
  ]);

  if (!tenant) {
    throw new Error('Conta não encontrada');
  }

  return mapGlobalAdminTenant360ToDTO({
    tenant: {
      id: tenant.id,
      nome: tenant.nome,
      financeStatus: tenant.financeStatus,
      createdAt: tenant.createdAt.toISOString(),
    },
    financial: {
      financeProfileId: tenant.financeProfile?.id ?? null,
      asaasAccountId: diagnostics.local.asaasAccountId,
      onboardingStatus: tenant.financeProfile?.asaasAccount?.status ?? null,
      asaasAccountStatus: diagnostics.local.asaasAccountStatus,
      hasSubaccountCredentials: diagnostics.local.hasSubaccountCredentials,
    },
    webhook: {
      status: diagnostics.status,
      recommendations: diagnostics.recommendations,
      hasRemoteWebhook: Boolean(diagnostics.remoteHealth?.webhooks.length),
      hasWebhookHash: diagnostics.local.hasWebhookAuthTokenHash,
    },
    queue: {
      backlog: diagnostics.queue.backlog,
      pending: diagnostics.queue.pending,
      processing: diagnostics.queue.processing,
      errored: diagnostics.queue.errored,
      exhausted: diagnostics.queue.exhausted,
      lagSeconds: diagnostics.queue.lagSeconds,
    },
    latestEvents: latestEvents.map((event) => ({
      id: event.id,
      evento: event.evento,
      eventId: event.eventId ?? null,
      status: event.status,
      tentativas: event.tentativas,
      recebidoEm: event.recebidoEm.toISOString(),
      processadoEm: toIsoDate(event.processadoEm),
      ultimoErro: event.ultimoErro ?? null,
      asaasPaymentId: event.asaasPaymentId ?? null,
    })),
    divergentCharges: {
      count: divergentCharges.length,
      items: divergentCharges.map((charge) => ({
        id: charge.id,
        descricao: charge.descricao ?? null,
        alunoNome: charge.matricula.aluno.nome,
        status: charge.status,
        asaasStatus: charge.asaasStatus ?? null,
        asaasPaymentId: charge.asaasPaymentId ?? null,
        valor: toNullableNumber(charge.valor),
        updatedAt: charge.updatedAt.toISOString(),
      })),
    },
    auditPreview: auditPreview.entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      status: entry.status,
      actorIdentifier: entry.actorIdentifier,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
  });
}
