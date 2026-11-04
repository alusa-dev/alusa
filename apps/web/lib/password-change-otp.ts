import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import prisma from '@/lib/prisma';
import { runWithTenant } from '@/lib/prisma-tenant';
import { auditLogService } from '@alusa/finance';
import { hashPassword, assertPasswordPolicy } from '@/lib/auth-password';
import { revokeUserSessions } from '@/lib/auth-service';
import type { AuthContext } from '@/lib/auth-service';
import { listAuthContextAccounts } from '@/lib/auth-service';
import { sendPasswordChangeOtpEmail } from '@/lib/email/password-change-otp-email';
import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

export const PASSWORD_CHANGE_OTP_COOLDOWN_SECONDS = 60;
export const PASSWORD_CHANGE_OTP_TTL_MINUTES = 10;
export const PASSWORD_CHANGE_VERIFICATION_TTL_MINUTES = 5;
const PASSWORD_CHANGE_OTP_MAX_ATTEMPTS = 5;

export type PasswordChangeChannel = 'email' | 'whatsapp';

export class PasswordChangeOtpError extends Error {
  public readonly code:
    | 'CHANNEL_UNAVAILABLE'
    | 'COOLDOWN_ACTIVE'
    | 'CHALLENGE_NOT_FOUND'
    | 'CHALLENGE_EXPIRED'
    | 'MAX_ATTEMPTS'
    | 'INVALID_CODE'
    | 'VERIFICATION_EXPIRED'
    | 'INVALID_VERIFICATION'
    | 'USER_UNAVAILABLE';
  public readonly status: number;

  constructor(
    message: string,
    code: PasswordChangeOtpError['code'],
    status = 400,
  ) {
    super(message);
    this.name = 'PasswordChangeOtpError';
    this.code = code;
    this.status = status;
  }
}

function getOtpSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente para o desafio OTP.');
  return secret;
}

function hashSecret(value: string): string {
  return createHmac('sha256', getOtpSecret()).update(value).digest('hex');
}

function hashCode(challengeId: string, code: string): string {
  return hashSecret(`password-change-code:${challengeId}:${code}`);
}

function hashVerificationToken(challengeId: string, token: string): string {
  return hashSecret(`password-change-verification:${challengeId}:${token}`);
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return 'seu e-mail cadastrado';
  const visible = localPart.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, localPart.length - visible.length))}@${domain}`;
}

function assertEmailChannel(channel: PasswordChangeChannel): asserts channel is 'email' {
  if (channel !== 'email') {
    throw new PasswordChangeOtpError(
      'Este método de envio estará disponível em breve.',
      'CHANNEL_UNAVAILABLE',
    );
  }
}

function toChallengeResponse(input: {
  id: string;
  channel: PasswordChangeChannel;
  email: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}) {
  return {
    challengeId: input.id,
    channel: input.channel,
    destination: maskEmail(input.email),
    expiresAt: input.expiresAt.toISOString(),
    resendAvailableAt: input.resendAvailableAt.toISOString(),
  };
}

async function hasActiveMembership(userId: string, contaId: string, authContext: AuthContext) {
  const accounts = await listAuthContextAccounts(userId, authContext);
  return accounts.some((account) => account.id === contaId);
}

export async function requestPasswordChangeOtp(input: {
  userId: string;
  contaId: string;
  channel: PasswordChangeChannel;
  authContext: AuthContext;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
}) {
  assertEmailChannel(input.channel);

  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { id: true, nome: true, email: true, status: true },
  });

  if (!user || user.status !== 'ATIVO' || !(await hasActiveMembership(input.userId, input.contaId, input.authContext))) {
    throw new PasswordChangeOtpError('Usuário indisponível.', 'USER_UNAVAILABLE', 404);
  }
  const credential = await prisma.authCredential.findUnique({
    where: { uq_auth_credential_context_user: { context: input.authContext, userId: user.id } },
    select: { normalizedEmail: true, emailVerifiedAt: true },
  });
  if (!credential?.emailVerifiedAt) throw new PasswordChangeOtpError('Credencial indisponível.', 'USER_UNAVAILABLE', 404);

  const { challengeId, code, expiresAt, resendAvailableAt } = await runWithTenant(
    input.contaId,
    async (tx) => {
      const now = new Date();
      const activeChallenge = await tx.passwordChangeOtp.findFirst({
        where: {
          userId: user.id,
          contaId: input.contaId,
          authContext: input.authContext,
          usedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        select: { resendAvailableAt: true },
      });

      if (activeChallenge && activeChallenge.resendAvailableAt > now) {
        throw new PasswordChangeOtpError(
          'Você tentou muitas vezes, aguarde alguns minutos.',
          'COOLDOWN_ACTIVE',
          429,
        );
      }

      const challengeId = randomBytes(18).toString('base64url');
      const code = generateOtpCode();
      const expiresAt = new Date(now.getTime() + PASSWORD_CHANGE_OTP_TTL_MINUTES * 60_000);
      const resendAvailableAt = new Date(
        now.getTime() + PASSWORD_CHANGE_OTP_COOLDOWN_SECONDS * 1000,
      );

      await tx.passwordChangeOtp.updateMany({
        where: {
          userId: user.id,
          contaId: input.contaId,
          authContext: input.authContext,
          usedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });

      await tx.passwordChangeOtp.create({
        data: {
          id: challengeId,
          userId: user.id,
          contaId: input.contaId,
          authContext: input.authContext,
          channel: 'EMAIL',
          codeHash: hashCode(challengeId, code),
          attempts: 0,
          maxAttempts: PASSWORD_CHANGE_OTP_MAX_ATTEMPTS,
          expiresAt,
          resendAvailableAt,
          requestedByIp: input.requestedByIp ?? null,
          requestedByUserAgent: input.requestedByUserAgent ?? null,
        },
      });

      return { challengeId, code, expiresAt, resendAvailableAt };
    },
  );

  try {
    const delivery = await sendPasswordChangeOtpEmail({
      challengeId,
      recipientName: user.nome,
      email: credential.normalizedEmail,
      code,
      expiresInLabel: `${PASSWORD_CHANGE_OTP_TTL_MINUTES} minutos`,
    });

    await runWithTenant(input.contaId, async (tx) => {
      await tx.passwordChangeOtp.updateMany({
        where: { id: challengeId, userId: user.id, contaId: input.contaId, authContext: input.authContext },
        data: { emailSentAt: new Date() },
      });
    });

    return {
      ...toChallengeResponse({
        id: challengeId,
        channel: input.channel,
        email: credential.normalizedEmail,
        expiresAt,
        resendAvailableAt,
      }),
      delivery: delivery.delivery,
    };
  } catch (error) {
    await runWithTenant(input.contaId, async (tx) => {
      await tx.passwordChangeOtp.updateMany({
        where: { id: challengeId, userId: user.id, contaId: input.contaId, usedAt: null },
        data: { invalidatedAt: new Date() },
      });
    });
    throw error;
  }
}

/**
 * OTP challenge reads and state transitions run inside the tenant transaction.
 * The authenticated user identifies the tenant; RLS remains the final database
 * boundary for challenge reads and writes.
 */
export async function verifyPasswordChangeOtp(input: {
  userId: string;
  contaId: string;
  challengeId: string;
  code: string;
  authContext: AuthContext;
}) {
  if (!(await hasActiveMembership(input.userId, input.contaId, input.authContext))) {
    throw new PasswordChangeOtpError('Código inválido ou expirado.', 'CHALLENGE_NOT_FOUND');
  }

  return runWithTenant(input.contaId, async (tx) => {
    const challenge = await tx.passwordChangeOtp.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        contaId: true,
        codeHash: true,
        attempts: true,
        maxAttempts: true,
        expiresAt: true,
        verifiedAt: true,
        usedAt: true,
        invalidatedAt: true,
        authContext: true,
      },
    });

    if (
      !challenge ||
      challenge.userId !== input.userId ||
      challenge.contaId !== input.contaId ||
      challenge.authContext !== input.authContext ||
      challenge.invalidatedAt ||
      challenge.usedAt
    ) {
      throw new PasswordChangeOtpError('Código inválido ou expirado.', 'CHALLENGE_NOT_FOUND');
    }

    const now = new Date();
    if (challenge.expiresAt <= now) {
      await tx.passwordChangeOtp.updateMany({
        where: {
          id: challenge.id,
          userId: input.userId,
          contaId: input.contaId,
          authContext: input.authContext,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      throw new PasswordChangeOtpError('Código expirado. Solicite um novo código.', 'CHALLENGE_EXPIRED');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new PasswordChangeOtpError(
        'Limite de tentativas atingido. Solicite um novo código.',
        'MAX_ATTEMPTS',
      );
    }

    const isValid = secureEqual(challenge.codeHash, hashCode(challenge.id, input.code));
    if (!isValid) {
      await tx.passwordChangeOtp.updateMany({
        where: {
          id: challenge.id,
          userId: input.userId,
          contaId: input.contaId,
          authContext: input.authContext,
          usedAt: null,
          invalidatedAt: null,
          attempts: { lt: challenge.maxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      throw new PasswordChangeOtpError('Código incorreto. Confira os dígitos e tente novamente.', 'INVALID_CODE');
    }

    const verificationToken = generateVerificationToken();
    const verificationExpiresAt = new Date(
      now.getTime() + PASSWORD_CHANGE_VERIFICATION_TTL_MINUTES * 60_000,
    );
    const claimed = await tx.passwordChangeOtp.updateMany({
      where: {
        id: challenge.id,
        userId: input.userId,
        contaId: input.contaId,
        authContext: input.authContext,
        verifiedAt: null,
        usedAt: null,
        invalidatedAt: null,
        attempts: { lt: challenge.maxAttempts },
      },
      data: {
        verifiedAt: now,
        verificationExpiresAt,
        verificationTokenHash: hashVerificationToken(challenge.id, verificationToken),
      },
    });

    if (claimed.count !== 1) {
      throw new PasswordChangeOtpError('Código inválido ou expirado.', 'CHALLENGE_NOT_FOUND');
    }

    return {
      verificationToken,
      verificationExpiresAt: verificationExpiresAt.toISOString(),
    };
  });
}

export async function completePasswordChange(input: {
  userId: string;
  contaId: string;
  challengeId: string;
  verificationToken: string;
  newPassword: string;
  authContext: AuthContext;
  revokeAllSessions: boolean;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
}) {
  assertPasswordPolicy(input.newPassword);

  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true },
  });
  if (!user || user.status !== 'ATIVO' || !(await hasActiveMembership(input.userId, input.contaId, input.authContext))) {
    throw new PasswordChangeOtpError('Usuário indisponível.', 'USER_UNAVAILABLE', 404);
  }

  const challenge = await runWithTenant(input.contaId, (tx) =>
    tx.passwordChangeOtp.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        verificationTokenHash: true,
        verifiedAt: true,
        verificationExpiresAt: true,
        expiresAt: true,
        usedAt: true,
        invalidatedAt: true,
        authContext: true,
      },
    }),
  );

  const now = new Date();
  if (
    !challenge ||
    challenge.userId !== input.userId ||
    challenge.authContext !== input.authContext ||
    !challenge.verifiedAt ||
    !challenge.verificationExpiresAt ||
    challenge.verificationExpiresAt <= now ||
    challenge.expiresAt <= now ||
    challenge.usedAt ||
    challenge.invalidatedAt ||
    !challenge.verificationTokenHash ||
    !secureEqual(
      challenge.verificationTokenHash,
      hashVerificationToken(challenge.id, input.verificationToken),
    )
  ) {
    throw new PasswordChangeOtpError(
      'A confirmação expirou. Inicie o processo novamente.',
      'INVALID_VERIFICATION',
    );
  }

  const senhaHash = await hashPassword(input.newPassword);

  await runWithTenant(input.contaId, async (tx) => {
    const claimed = await tx.passwordChangeOtp.updateMany({
      where: {
        id: challenge.id,
        userId: input.userId,
        contaId: input.contaId,
        verifiedAt: { not: null },
        usedAt: null,
        invalidatedAt: null,
        verificationExpiresAt: { gt: now },
        verificationTokenHash: challenge.verificationTokenHash,
      },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      throw new PasswordChangeOtpError(
        'A confirmação expirou. Inicie o processo novamente.',
        'INVALID_VERIFICATION',
      );
    }

    const updatedCredential = await tx.authCredential.updateMany({
      where: { userId: user.id, context: input.authContext },
      data: { passwordHash: senhaHash, sessionVersion: { increment: 1 } },
    });
    if (updatedCredential.count !== 1) {
      throw new PasswordChangeOtpError('Usuário indisponível.', 'USER_UNAVAILABLE', 404);
    }

    await tx.mobileAuthSession.updateMany({
      where: { userId: user.id, authContext: input.authContext, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now },
    });

    if (input.revokeAllSessions) {
      await revokeUserSessions(user.id, tx);
    }
  });

  try {
    await auditLogService.record({
      contaId: input.contaId,
      action: 'auth.password_changed',
      entity: { type: 'Usuario', id: user.id },
      actor: { type: 'USER', id: user.id },
      metadata: {
        result: 'success',
        verification: 'otp_email',
        revokedAllSessions: input.revokeAllSessions,
        ip: input.requestedByIp ?? null,
        userAgent: input.requestedByUserAgent ?? null,
      },
    });
  } catch (error) {
    logRuntimeOperationalEvent({ eventName: 'auth.password_change.audit_failed', error });
  }

  return { ok: true, revokedAllSessions: input.revokeAllSessions };
}
