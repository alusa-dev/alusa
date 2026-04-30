import { prisma } from '@alusa/database';

import { mapGlobalAdminSupportCaseResultToDTO } from './mappers';

const REMOTE_PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const LOCAL_FINAL_STATUSES = ['PAGO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];

function getWindowStart(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function severityWeight(value: 'critical' | 'warning' | 'info') {
  if (value === 'critical') return 3;
  if (value === 'warning') return 2;
  return 1;
}

export async function listGlobalAdminSupportCases(input: { limit?: number; windowDays?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30)));
  const windowDays = Math.max(1, Math.min(30, Math.trunc(input.windowDays ?? 14)));
  const windowStart = getWindowStart(windowDays);

  const [integrationErrors, divergentCharges, failedWebhooks, rejectedWebhooks, pendingAccessUsers, recentCancellations] =
    await Promise.all([
      prisma.logIntegracao.findMany({
        where: {
          createdAt: { gte: windowStart },
          status: 'ERROR',
          tipoOperacao: { in: ['CREATE_PAYMENT', 'CREATE_INSTALLMENT', 'CREATE_SUBSCRIPTION'] },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          contaId: true,
          tipoOperacao: true,
          entidade: true,
          entidadeId: true,
          errorMessage: true,
          createdAt: true,
          conta: { select: { nome: true } },
        },
      }),
      prisma.cobranca.findMany({
        where: {
          updatedAt: { gte: windowStart },
          matricula: { aluno: { conta: { deletedAt: null } } },
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
        take: limit,
        select: {
          id: true,
          descricao: true,
          status: true,
          asaasStatus: true,
          updatedAt: true,
          matricula: {
            select: {
              aluno: {
                select: {
                  nome: true,
                  contaId: true,
                  conta: { select: { nome: true } },
                },
              },
            },
          },
        },
      }),
      prisma.webhookAsaas.findMany({
        where: {
          recebidoEm: { gte: windowStart },
          status: { in: ['ERRO', 'EXAURIDO'] },
        },
        orderBy: { recebidoEm: 'desc' },
        take: limit,
        select: {
          id: true,
          contaId: true,
          evento: true,
          status: true,
          ultimoErro: true,
          recebidoEm: true,
          conta: { select: { nome: true } },
        },
      }),
      prisma.webhookAsaasRejection.findMany({
        where: { recebidoEm: { gte: windowStart } },
        orderBy: { recebidoEm: 'desc' },
        take: limit,
        select: {
          id: true,
          contaId: true,
          evento: true,
          reason: true,
          recebidoEm: true,
        },
      }),
      prisma.usuario.findMany({
        where: {
          status: 'ATIVO',
          emailVerifiedAt: null,
          conta: { deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          nome: true,
          email: true,
          createdAt: true,
          contaId: true,
          conta: { select: { nome: true } },
        },
      }),
      prisma.conta.findMany({
        where: { deletedAt: { gte: windowStart } },
        orderBy: { deletedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          nome: true,
          deletedAt: true,
          deleteReason: true,
        },
      }),
    ]);

  const rejectionAccountMap =
    rejectedWebhooks.filter((item) => item.contaId).length > 0
      ? new Map(
          (
            await prisma.conta.findMany({
              where: {
                id: {
                  in: rejectedWebhooks.flatMap((item) => (item.contaId ? [item.contaId] : [])),
                },
              },
              select: { id: true, nome: true },
            })
          ).map((item) => [item.id, item.nome]),
        )
      : new Map<string, string>();

  const items = [
    ...integrationErrors.map((item) => ({
      id: `integration:${item.id}`,
      type: 'cobranca_nao_criada',
      severity: 'critical' as const,
      title: 'Cobrança com falha na criação',
      summary: item.errorMessage ?? `${item.tipoOperacao} falhou para ${item.entidade}.`,
      contaId: item.contaId,
      contaNome: item.conta.nome,
      personName: null,
      detectedAt: item.createdAt.toISOString(),
      statusLabel: 'Falha de integração',
      suggestedAction: 'Abrir conta e verificar cobrança',
      href: `/developer/tenants/${item.contaId}`,
    })),
    ...divergentCharges.map((item) => ({
      id: `charge:${item.id}`,
      type: 'pagamento_sem_atualizacao',
      severity: 'warning' as const,
      title: 'Pagamento sem atualização no sistema',
      summary: `${item.matricula.aluno.nome} está com cobrança ${item.status} e Asaas ${item.asaasStatus ?? 'sem status'}.`,
      contaId: item.matricula.aluno.contaId,
      contaNome: item.matricula.aluno.conta.nome,
      personName: item.matricula.aluno.nome,
      detectedAt: item.updatedAt.toISOString(),
      statusLabel: 'Diferença entre sistema e pagamento',
      suggestedAction: 'Sincronizar cobrança',
      href: `/developer/tenants/${item.matricula.aluno.contaId}?focusCharge=${item.id}`,
    })),
    ...failedWebhooks.map((item) => ({
      id: `webhook:${item.id}`,
      type: 'webhook_com_falha',
      severity: 'warning' as const,
      title: 'Webhook não processado',
      summary: item.ultimoErro ?? `${item.evento} ficou com status ${item.status}.`,
      contaId: item.contaId,
      contaNome: item.conta.nome,
      personName: null,
      detectedAt: item.recebidoEm.toISOString(),
      statusLabel: 'Falha no recebimento do evento',
      suggestedAction: 'Abrir webhooks da conta',
      href: `/developer/tenants/${item.contaId}?focusEvent=${item.id}`,
    })),
    ...rejectedWebhooks.map((item) => ({
      id: `rejection:${item.id}`,
      type: 'webhook_rejeitado',
      severity: 'critical' as const,
      title: 'Webhook rejeitado pela Alusa',
      summary: item.reason,
      contaId: item.contaId ?? null,
      contaNome: item.contaId ? rejectionAccountMap.get(item.contaId) ?? null : null,
      personName: null,
      detectedAt: item.recebidoEm.toISOString(),
      statusLabel: 'Evento recusado',
      suggestedAction: item.contaId ? 'Conferir autenticação do webhook' : 'Revisar rejeição',
      href: item.contaId ? `/developer/tenants/${item.contaId}` : '/developer/webhooks',
    })),
    ...pendingAccessUsers.map((item) => ({
      id: `access:${item.id}`,
      type: 'acesso_pendente',
      severity: 'info' as const,
      title: 'Usuário com acesso pendente',
      summary: `${item.nome} ainda não confirmou o acesso pelo e-mail ${item.email}.`,
      contaId: item.contaId,
      contaNome: item.conta.nome,
      personName: item.nome,
      detectedAt: item.createdAt.toISOString(),
      statusLabel: 'Confirmação pendente',
      suggestedAction: 'Abrir usuário e conferir acesso',
      href: `/developer/users/${item.id}`,
    })),
    ...recentCancellations.map((item) => ({
      id: `cancel:${item.id}`,
      type: 'cancelamento_recente',
      severity: 'info' as const,
      title: 'Conta cancelada recentemente',
      summary: item.deleteReason?.trim() || 'Cancelamento sem motivo registrado.',
      contaId: item.id,
      contaNome: item.nome,
      personName: null,
      detectedAt: item.deletedAt?.toISOString() ?? new Date().toISOString(),
      statusLabel: 'Cancelada',
      suggestedAction: 'Abrir conta para contexto',
      href: `/developer/tenants/${item.id}`,
    })),
  ]
    .sort((left, right) => {
      const severityDiff = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDiff !== 0) return severityDiff;
      return new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime();
    })
    .slice(0, limit);

  return mapGlobalAdminSupportCaseResultToDTO({
    generatedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: items.filter((item) => item.severity === 'warning').length,
      informational: items.filter((item) => item.severity === 'info').length,
    },
    items,
  });
}
