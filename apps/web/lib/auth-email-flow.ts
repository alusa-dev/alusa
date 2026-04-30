import type { AuthActionTokenType, Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildAppUrl } from '@/lib/app-url';
import { safeRedirect } from '@/lib/safe-redirect';
import { auditLogService } from '@alusa/finance';
import {
  consumeAuthActionToken,
  createAuthActionToken,
  findAuthActionTokenByPlainToken,
  getAuthActionTokenExpiryLabel,
  invalidateAuthActionTokens,
  markAuthActionTokenEmailSent,
} from '@/lib/auth-action-tokens';
import {
  buildAccountReactivationTemplate,
  buildInviteUserTemplate,
  buildResetPasswordTemplate,
  buildVerifyEmailTemplate,
} from '@/lib/email/auth-email-templates';
import { sendTransactionalEmail } from '@/lib/email/transactional-email';
import { assertPasswordPolicy, hashPassword } from '@/lib/auth-password';

type RequestMetadata = {
  ip?: string | null;
  userAgent?: string | null;
};

type AuthEmailOptions = {
  callbackUrl?: string | null;
  intent?: 'VERIFY_EMAIL' | 'ACCOUNT_REACTIVATION';
};

function isAccountDeactivated(status: string | null | undefined, deletedAt: Date | null | undefined): boolean {
  return Boolean(deletedAt) || (typeof status === 'string' && status.toUpperCase() !== 'ATIVO');
}

function buildVerifyEmailUrl(token: string, callbackUrl?: string | null): string {
  const params = new URLSearchParams({ token });
  const redirectTo = safeRedirect(callbackUrl, '');

  if (redirectTo) {
    params.set('callbackUrl', redirectTo);
  }

  return buildAppUrl(`/auth/verify-email?${params.toString()}`);
}

function buildResetPasswordUrl(token: string): string {
  return buildAppUrl(`/auth/reset-password?token=${encodeURIComponent(token)}`);
}

function getRoleLabel(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return 'administrador';
    case 'PROFESSOR':
      return 'professor';
    case 'RECEPCAO':
      return 'recepção';
    case 'FINANCEIRO':
      return 'financeiro';
    case 'RESPONSAVEL':
      return 'responsável';
    default:
      return 'usuário';
  }
}

async function issueAuthEmail(
  type: AuthActionTokenType,
  userId: string,
  metadata: RequestMetadata,
  options: AuthEmailOptions = {},
) {
  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nome: true,
      email: true,
      emailVerifiedAt: true,
      contaId: true,
      conta: {
        select: {
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  const isReactivationEmail =
    type === 'VERIFY_EMAIL' &&
    (options.intent === 'ACCOUNT_REACTIVATION' ||
      isAccountDeactivated(user.conta?.status, user.conta?.deletedAt));

  if (type === 'VERIFY_EMAIL' && user.emailVerifiedAt && !isReactivationEmail) {
    return { delivery: 'sent' as const, emailId: null, actionUrl: null };
  }

  const { token, record } = await createAuthActionToken({
    userId: user.id,
    email: user.email,
    type,
    requestedByIp: metadata.ip,
    requestedByUserAgent: metadata.userAgent,
  });

  const actionUrl =
    type === 'VERIFY_EMAIL'
      ? buildVerifyEmailUrl(
          token,
          isReactivationEmail ? options.callbackUrl ?? '/auth/login?reactivated=1' : options.callbackUrl,
        )
      : buildResetPasswordUrl(token);

  const expiresInLabel = getAuthActionTokenExpiryLabel(type);
  const template =
    type === 'VERIFY_EMAIL'
      ? isReactivationEmail
        ? buildAccountReactivationTemplate({
            recipientName: user.nome,
            actionUrl,
            expiresInLabel,
          })
        : buildVerifyEmailTemplate({
            recipientName: user.nome,
            actionUrl,
            expiresInLabel,
          })
      : buildResetPasswordTemplate({
          recipientName: user.nome,
          actionUrl,
          expiresInLabel,
        });

  const category =
    type === 'VERIFY_EMAIL'
      ? isReactivationEmail
        ? 'account_reactivation'
        : 'verify_email'
      : 'reset_password';

  const delivery = await sendTransactionalEmail({
    to: user.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category,
    idempotencyKey: `${category}/${record.id}`,
    actionUrl,
    tags: [
      { name: 'category', value: category },
      { name: 'user_id', value: user.id },
    ],
  });

  await markAuthActionTokenEmailSent(record.id, delivery.emailId);

  return {
    ...delivery,
    actionUrl,
  };
}

export async function sendEmailVerificationForUser(
  userId: string,
  metadata: RequestMetadata = {},
  options: AuthEmailOptions = {},
) {
  return issueAuthEmail('VERIFY_EMAIL', userId, metadata, options);
}

export async function sendAccountReactivationForEmail(
  email: string,
  metadata: RequestMetadata = {},
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.usuario.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
      conta: {
        OR: [{ deletedAt: { not: null } }, { status: { not: 'ATIVO' } }],
      },
    },
    select: {
      id: true,
      contaId: true,
    },
  });

  if (!user?.contaId) {
    return;
  }

  const delivery = await issueAuthEmail(
    'VERIFY_EMAIL',
    user.id,
    metadata,
    {
      intent: 'ACCOUNT_REACTIVATION',
      callbackUrl: '/auth/login?reactivated=1',
    },
  );

  await auditLogService.record({
    contaId: user.contaId,
    action: 'conta.reactivation_requested',
    entity: { type: 'Conta', id: user.contaId },
    metadata: {
      channel: 'email',
      delivery: delivery.delivery,
      resendEmailId: delivery.emailId ?? null,
    },
    actor: { type: 'USER', id: user.id },
  });
}

export async function sendPasswordResetForEmail(
  email: string,
  metadata: RequestMetadata = {},
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.usuario.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: 'ATIVO',
    },
    select: {
      id: true,
      contaId: true,
      email: true,
    },
  });

  if (!user?.contaId) {
    return;
  }

  await issueAuthEmail('RESET_PASSWORD', user.id, metadata);
}

export async function sendInviteEmail(input: {
  inviteId: string;
  inviteUrl: string;
  email: string;
  role: Role;
  invitedByName?: string | null;
}) {
  const template = buildInviteUserTemplate({
    inviteUrl: input.inviteUrl,
    roleLabel: getRoleLabel(input.role),
    invitedByName: input.invitedByName,
    expiresInLabel: '7 dias',
  });

  return sendTransactionalEmail({
    to: input.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: 'invite_user',
    idempotencyKey: `invite-user/${input.inviteId}`,
    actionUrl: input.inviteUrl,
    tags: [
      { name: 'category', value: 'invite_user' },
      { name: 'invite_id', value: input.inviteId },
    ],
  });
}

export async function verifyEmailByToken(token: string) {
  const consumed = await consumeAuthActionToken('VERIFY_EMAIL', token);

  if (!consumed) {
    const existing = await findAuthActionTokenByPlainToken('VERIFY_EMAIL', token);
    if (existing?.usedAt && existing.user.emailVerifiedAt) {
      return existing.user;
    }
    return null;
  }

  let reactivatedAccount = false;
  await prisma.$transaction(async (tx) => {
    const conta = await tx.conta.findUnique({
      where: { id: consumed.user.contaId },
      select: { status: true, deletedAt: true },
    });

    if (!consumed.user.emailVerifiedAt) {
      await tx.usuario.update({
        where: { id: consumed.user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    if (conta && isAccountDeactivated(conta.status, conta.deletedAt)) {
      reactivatedAccount = true;
      await tx.conta.update({
        where: { id: consumed.user.contaId },
        data: {
          status: 'ATIVO',
          deletedAt: null,
          deletedByUserId: null,
          deleteReason: null,
        },
      });
    }

    await invalidateAuthActionTokens(consumed.user.id, 'VERIFY_EMAIL', tx);
  });

  if (reactivatedAccount) {
    await auditLogService.record({
      contaId: consumed.user.contaId,
      action: 'conta.reactivated',
      entity: { type: 'Conta', id: consumed.user.contaId },
      metadata: {
        channel: 'email_verification_link',
      },
      actor: { type: 'USER', id: consumed.user.id },
    });
  }

  return consumed.user;
}

export async function resetPasswordByToken(input: { token: string; password: string }) {
  assertPasswordPolicy(input.password);

  const consumed = await consumeAuthActionToken('RESET_PASSWORD', input.token);
  if (!consumed) {
    return null;
  }

  const senhaHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: consumed.user.id },
      data: { senhaHash },
    });

    await invalidateAuthActionTokens(consumed.user.id, 'RESET_PASSWORD', tx);
  });

  return consumed.user;
}
