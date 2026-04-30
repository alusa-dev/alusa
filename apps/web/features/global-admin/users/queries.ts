import type { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';

import { listGlobalAdminAudit } from '../audit/queries';
import { listGlobalAdminErrorLogs, listGlobalAdminRequestLogs, listGlobalAdminWebhookLogs } from '../logs/queries';
import {
  mapGlobalAdminUserListToDTO,
  mapGlobalAdminUserSupportProfileToDTO,
} from './mappers';

const REMOTE_PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const LOCAL_FINAL_STATUSES = ['PAGO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];

function containsInsensitive(value: string) {
  return { contains: value, mode: 'insensitive' as const };
}

function clampLimit(value: number | undefined, fallback = 50, max = 200) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value ?? fallback)));
}

function toNullableNumber(value: unknown) {
  if (value == null) return null;
  return Number(value);
}

export async function listGlobalAdminUsers(input: {
  q?: string;
  status?: 'ALL' | 'ACTIVE' | 'PENDING_ACCESS' | 'CANCELLED';
  limit?: number;
} = {}) {
  const q = input.q?.trim() ?? '';
  const limit = clampLimit(input.limit, 100);
  const status = input.status ?? 'ALL';

  const where: Prisma.UsuarioWhereInput = {
    ...(q
      ? {
          OR: [
            { id: { contains: q } },
            { nome: containsInsensitive(q) },
            { email: containsInsensitive(q) },
            { telefone: { contains: q } },
            { contaId: { contains: q } },
            { conta: { nome: containsInsensitive(q) } },
          ],
        }
      : {}),
  };

  if (status === 'ACTIVE') {
    where.status = 'ATIVO';
    where.conta = { deletedAt: null };
  } else if (status === 'PENDING_ACCESS') {
    where.status = 'ATIVO';
    where.emailVerifiedAt = null;
    where.conta = { deletedAt: null };
  } else if (status === 'CANCELLED') {
    where.conta = { deletedAt: { not: null } };
  }

  const [summary, items] = await Promise.all([
    prisma.usuario.aggregate({
      _count: { _all: true },
      where,
    }),
    prisma.usuario.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        contaId: true,
        conta: {
          select: {
            nome: true,
            financeStatus: true,
            deletedAt: true,
          },
        },
      },
    }),
  ]);

  const [activeUsers, pendingAccess, cancelledAccounts] = await Promise.all([
    prisma.usuario.count({
      where: {
        status: 'ATIVO',
        conta: { deletedAt: null },
      },
    }),
    prisma.usuario.count({
      where: {
        status: 'ATIVO',
        emailVerifiedAt: null,
        conta: { deletedAt: null },
      },
    }),
    prisma.usuario.count({
      where: {
        conta: { deletedAt: { not: null } },
      },
    }),
  ]);

  return mapGlobalAdminUserListToDTO({
    generatedAt: new Date().toISOString(),
    summary: {
      total: summary._count._all,
      activeUsers,
      pendingAccess,
      cancelledAccounts,
    },
    items: items.map((item) => ({
      id: item.id,
      nome: item.nome,
      email: item.email,
      telefone: item.telefone ?? null,
      role: item.role,
      status: item.status,
      accessStatus: item.emailVerifiedAt ? 'Acesso liberado' : 'Confirmação pendente',
      contaId: item.contaId,
      contaNome: item.conta.nome,
      contaStatus: item.conta.deletedAt ? 'CANCELADA' : 'ATIVA',
      financeStatus: item.conta.financeStatus,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      deletedAt: item.conta.deletedAt?.toISOString() ?? null,
      href: `/developer/users/${item.id}`,
    })),
  });
}

export async function getGlobalAdminUserSupportProfile(userId: string) {
  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nome: true,
      email: true,
      telefone: true,
      role: true,
      status: true,
      createdAt: true,
      emailVerifiedAt: true,
      contaId: true,
      conta: {
        select: {
          nome: true,
          financeStatus: true,
          deletedAt: true,
          deleteReason: true,
        },
      },
      authActionTokens: {
        where: {
          type: 'RESET_PASSWORD',
          invalidatedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          createdAt: true,
          expiresAt: true,
          usedAt: true,
        },
      },
    },
  });

  if (!user) throw new Error('Usuário não encontrado');

  const now = new Date();
  const [openCharges, divergentCharges, integrationErrors, webhookErrors, recentCharges, recentRequestLogs, recentWebhookLogs, recentErrors, auditPreview] =
    await Promise.all([
      prisma.cobranca.count({
        where: {
          matricula: { aluno: { usuarioId: userId } },
          status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO', 'CANCELAMENTO_PENDENTE'] as never[] },
        },
      }),
      prisma.cobranca.count({
        where: {
          matricula: { aluno: { usuarioId: userId } },
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
      }),
      prisma.logIntegracao.count({
        where: {
          contaId: user.contaId,
          status: 'ERROR',
        },
      }),
      prisma.webhookAsaas.count({
        where: {
          contaId: user.contaId,
          status: { in: ['ERRO', 'EXAURIDO'] },
        },
      }),
      prisma.cobranca.findMany({
        where: { matricula: { aluno: { usuarioId: userId } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 6,
        select: {
          id: true,
          descricao: true,
          status: true,
          asaasStatus: true,
          vencimento: true,
          valor: true,
        },
      }),
      listGlobalAdminRequestLogs({ contaId: user.contaId, limit: 5 }),
      listGlobalAdminWebhookLogs({ contaId: user.contaId, limit: 5 }),
      listGlobalAdminErrorLogs({ contaId: user.contaId, limit: 5 }),
      listGlobalAdminAudit({ tenantId: user.contaId, limit: 5 }),
    ]);

  const validPasswordResets = user.authActionTokens.filter(
    (item) => item.expiresAt > now && item.usedAt === null,
  );

  return mapGlobalAdminUserSupportProfileToDTO({
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      telefone: user.telefone ?? null,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      contaId: user.contaId,
      contaNome: user.conta.nome,
      financeStatus: user.conta.financeStatus,
      accountDeletedAt: user.conta.deletedAt?.toISOString() ?? null,
      accountDeleteReason: user.conta.deleteReason ?? null,
    },
    support: {
      accessStatus: user.emailVerifiedAt ? 'Pode entrar normalmente' : 'Precisa confirmar o acesso',
      passwordResetOpenRequests: validPasswordResets.length,
      lastPasswordResetAt: user.authActionTokens[0]?.createdAt.toISOString() ?? null,
      openCharges,
      divergentCharges,
      integrationErrors,
      webhookErrors,
    },
    recentCharges: recentCharges.map((charge) => ({
      id: charge.id,
      descricao: charge.descricao ?? null,
      status: charge.status,
      asaasStatus: charge.asaasStatus ?? null,
      vencimento: charge.vencimento.toISOString(),
      valor: toNullableNumber(charge.valor),
      href: `/developer/search?q=${charge.id}`,
    })),
    recentRequestLogs: recentRequestLogs.items,
    recentWebhookLogs: recentWebhookLogs.items,
    recentErrors: recentErrors.items,
    auditPreview: auditPreview.entries,
  });
}
