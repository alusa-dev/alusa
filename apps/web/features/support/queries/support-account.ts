import prisma from '@/lib/prisma';

export async function getSupportAccount(contaId: string) {
  const [conta, counts, recentCharges, recentWebhooks, recentAudit] = await Promise.all([
    prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        status: true,
        financeStatus: true,
        financeIntegrationMode: true,
        externalAsaasOnboardingStatus: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        financeProfile: {
          select: {
            status: true,
            isOnboardingCompleted: true,
            onboardingCompletedAt: true,
            lastAsaasSyncAt: true,
            asaasAccountId: true,
            asaasAccount: {
              select: {
                asaasAccountId: true,
                status: true,
                apiKeyStatus: true,
                webhookAuthTokenHash: true,
                documentsCacheUpdatedAt: true,
                kycProcess: {
                  select: {
                    status: true,
                    rejectReasons: true,
                    lastWebhookEventId: true,
                    lastAsaasSyncAt: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    Promise.all([
      prisma.usuarioConta.count({ where: { contaId } }),
      prisma.aluno.count({ where: { contaId, status: 'ATIVO' } }),
      prisma.responsavel.count({ where: { contaId } }),
      prisma.matricula.count({ where: { contaId, status: 'ATIVA' } }),
      prisma.chargeReadModel.count({ where: { contaId } }),
      prisma.chargeReadModel.count({
        where: { contaId, status: { in: ['PENDING', 'PENDENTE', 'OVERDUE', 'ATRASADO'] } },
      }),
      prisma.webhookAsaas.count({
        where: { contaId, status: { in: ['ERRO', 'FAILED', 'ERROR'] } },
      }),
    ]),
    prisma.chargeReadModel.findMany({
      where: { contaId },
      select: {
        id: true,
        payerName: true,
        description: true,
        status: true,
        value: true,
        dueDate: true,
        billingType: true,
        asaasPaymentId: true,
        updatedAt: true,
      },
      take: 6,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.webhookAsaas.findMany({
      where: { contaId },
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        processadoEm: true,
        ultimoErro: true,
      },
      take: 6,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: { contaId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorType: true,
        actorId: true,
        createdAt: true,
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const [
    usuarios,
    alunos,
    responsaveis,
    matriculasAtivas,
    totalCobrancas,
    cobrancasAbertas,
    webhooksComErro,
  ] = counts;

  return conta
    ? {
        conta,
        counts: {
          usuarios,
          alunos,
          responsaveis,
          matriculasAtivas,
          totalCobrancas,
          cobrancasAbertas,
          webhooksComErro,
        },
        recentCharges,
        recentWebhooks,
        recentAudit,
      }
    : null;
}

export async function listSupportAccountFinance(contaId?: string) {
  return prisma.chargeReadModel.findMany({
    where: contaId ? { contaId } : undefined,
    select: {
      id: true,
      contaId: true,
      payerName: true,
      description: true,
      sourceKind: true,
      sourceId: true,
      origin: true,
      chargeType: true,
      status: true,
      value: true,
      dueDate: true,
      billingType: true,
      asaasPaymentId: true,
      matriculaId: true,
      alunoId: true,
      updatedAt: true,
      conta: { select: { nome: true } },
    },
    take: 50,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listSupportWebhooks(contaId?: string) {
  return prisma.webhookAsaas.findMany({
    where: contaId ? { contaId } : undefined,
    select: {
      id: true,
      contaId: true,
      evento: true,
      eventId: true,
      status: true,
      recebidoEm: true,
      processadoEm: true,
      tentativas: true,
      ultimoErro: true,
      asaasPaymentId: true,
      asaasSubscriptionId: true,
      asaasTransferId: true,
      conta: { select: { nome: true } },
    },
    take: 50,
    orderBy: { recebidoEm: 'desc' },
  });
}

export async function listSupportAudit(contaId?: string) {
  const supportLogs = await prisma.supportAuditLog.findMany({
    where: contaId ? { contaId } : undefined,
    select: {
      id: true,
      contaId: true,
      actorRole: true,
      actorUsername: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      correlationId: true,
      createdAt: true,
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  const contaIds = Array.from(new Set(supportLogs.map((item) => item.contaId).filter(Boolean))) as string[];
  const contas = await prisma.conta.findMany({
    where: { id: { in: contaIds } },
    select: { id: true, nome: true },
  });
  const names = new Map(contas.map((item) => [item.id, item.nome]));

  return supportLogs.map((item) => ({
    ...item,
    actorType: item.actorRole ?? 'SUPPORT',
    actorId: item.actorUsername ?? null,
    conta: { nome: item.contaId ? names.get(item.contaId) ?? item.contaId : 'Sem conta' },
  }));
}

export async function getSupportTimeline(contaId: string) {
  const [audit, supportAudit, webhooks, charges, matriculas, notes] = await Promise.all([
    prisma.auditLog.findMany({
      where: { contaId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorType: true,
        createdAt: true,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supportAuditLog.findMany({
      where: { contaId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorUsername: true,
        createdAt: true,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.webhookAsaas.findMany({
      where: { contaId },
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
      },
      take: 20,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.chargeReadModel.findMany({
      where: { contaId },
      select: {
        id: true,
        payerName: true,
        status: true,
        value: true,
        asaasPaymentId: true,
        createdAt: true,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.matricula.findMany({
      where: { contaId },
      select: {
        id: true,
        status: true,
        statusFinanceiro: true,
        createdAt: true,
        aluno: { select: { nome: true } },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supportNote.findMany({
      where: { contaId },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        authorName: true,
        body: true,
        createdAt: true,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return [
    ...audit.map((item) => ({
      id: `audit-${item.id}`,
      at: item.createdAt,
      type: 'Auditoria',
      title: item.action,
      description: `${item.actorType}${item.entityType ? ` em ${item.entityType}` : ''}`,
      status: item.entityId ?? undefined,
    })),
    ...webhooks.map((item) => ({
      id: `webhook-${item.id}`,
      at: item.recebidoEm,
      type: 'Webhook',
      title: item.evento,
      description: item.eventId ?? 'Evento sem eventId',
      status: item.status,
    })),
    ...supportAudit.map((item) => ({
      id: `support-audit-${item.id}`,
      at: item.createdAt,
      type: 'Suporte',
      title: item.action,
      description: `${item.actorUsername ?? 'Sistema'}${item.entityType ? ` em ${item.entityType}` : ''}`,
      status: item.entityId ?? undefined,
    })),
    ...notes.map((item) => ({
      id: `support-note-${item.id}`,
      at: item.createdAt,
      type: 'Nota interna',
      title: item.entityType,
      description: `${item.authorName ?? 'Suporte'}: ${item.body.slice(0, 120)}`,
      status: item.entityId,
    })),
    ...charges.map((item) => ({
      id: `charge-${item.id}`,
      at: item.createdAt,
      type: 'Cobrança',
      title: item.payerName,
      description: item.asaasPaymentId ?? item.id,
      status: item.status,
    })),
    ...matriculas.map((item) => ({
      id: `matricula-${item.id}`,
      at: item.createdAt,
      type: 'Matrícula',
      title: item.aluno.nome,
      description: item.id,
      status: `${item.status} · ${item.statusFinanceiro}`,
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime());
}

export async function getSupportFinanceOverview(contaId?: string) {
  const where = contaId ? { contaId } : undefined;
  const [
    subscriptions,
    standaloneSubscriptions,
    installmentPlans,
    standaloneInstallments,
    transfers,
    divergentCharges,
    integrationJobs,
  ] = await Promise.all([
    prisma.subscription.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        status: true,
        asaasSubscriptionId: true,
        matriculaId: true,
        updatedAt: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.standaloneSubscription.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        status: true,
        asaasSubscriptionId: true,
        value: true,
        nextDueDate: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.installmentPlan.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        status: true,
        asaasInstallmentId: true,
        value: true,
        installmentCount: true,
        firstDueDate: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.standaloneInstallmentPlan.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        status: true,
        asaasInstallmentId: true,
        value: true,
        installmentCount: true,
        firstDueDate: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.transferRequest.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        status: true,
        value: true,
        asaasTransferId: true,
        rawAsaasStatus: true,
        createdAt: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.cobranca.findMany({
      where: {
        ...(contaId ? { contaId } : {}),
        asaasStatus: { not: null },
        NOT: { asaasStatus: '' },
      },
      select: {
        id: true,
        contaId: true,
        status: true,
        asaasStatus: true,
        asaasPaymentId: true,
        valor: true,
        asaasValue: true,
        updatedAt: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.asaasIntegrationJob.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        type: true,
        status: true,
        attempts: true,
        lastError: true,
        nextAttemptAt: true,
        createdAt: true,
        conta: { select: { nome: true } },
      },
      take: 30,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    subscriptions,
    standaloneSubscriptions,
    installmentPlans,
    standaloneInstallments,
    transfers,
    divergentCharges: divergentCharges.filter(
      (item) =>
        item.asaasStatus &&
        item.status &&
        !String(item.asaasStatus).toUpperCase().includes(String(item.status).toUpperCase()),
    ),
    integrationJobs,
  };
}

export async function getSupportWebhookAdvanced(contaId?: string) {
  const where = contaId ? { contaId } : undefined;
  const [active, archived, rejected] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        ultimoErro: true,
        conta: { select: { nome: true } },
      },
      take: 30,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.webhookAsaasArchive.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        archivedAt: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { archivedAt: 'desc' },
    }),
    prisma.webhookAsaasRejection.findMany({
      where: contaId ? { contaId } : undefined,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        reason: true,
        recebidoEm: true,
      },
      take: 20,
      orderBy: { recebidoEm: 'desc' },
    }),
  ]);

  return { active, archived, rejected };
}
