import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import prisma from '@/lib/prisma';
import { auditLogService } from '@alusa/finance';
import { hashPassword, assertPasswordPolicy } from '@/lib/auth-password';
import { revokeUserSessions } from '@/lib/auth-service';
import { sendPasswordChangeOtpEmail } from '@/lib/email/password-change-otp-email';

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

export async function requestPasswordChangeOtp(input: {
  userId: string;
  channel: PasswordChangeChannel;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
}) {
  assertEmailChannel(input.channel);

  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { id: true, nome: true, email: true, contaId: true, status: true },
  });

  if (!user || user.status !== 'ATIVO' || !user.contaId) {
    throw new PasswordChangeOtpError('Usuário indisponível.', 'USER_UNAVAILABLE', 404);
  }

  const now = new Date();
  const activeChallenge = await prisma.passwordChangeOtp.findFirst({
    where: {
      userId: user.id,
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
  const resendAvailableAt = new Date(now.getTime() + PASSWORD_CHANGE_OTP_COOLDOWN_SECONDS * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordChangeOtp.updateMany({
      where: { userId: user.id, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });

    await tx.passwordChangeOtp.create({
      data: {
        id: challengeId,
        userId: user.id,
        contaId: user.contaId,
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
  });

  try {
    const delivery = await sendPasswordChangeOtpEmail({
      challengeId,
      recipientName: user.nome,
      email: user.email,
      code,
      expiresInLabel: `${PASSWORD_CHANGE_OTP_TTL_MINUTES} minutos`,
    });

    await prisma.passwordChangeOtp.update({
      where: { id: challengeId },
      data: { emailSentAt: new Date() },
    });

    return {
      ...toChallengeResponse({
        id: challengeId,
        channel: input.channel,
        email: user.email,
        expiresAt,
        resendAvailableAt,
      }),
      delivery: delivery.delivery,
    };
  } catch (error) {
    await prisma.passwordChangeOtp.updateMany({
      where: { id: challengeId, usedAt: null },
      data: { invalidatedAt: new Date() },
    });
    throw error;
  }
}

export async function verifyPasswordChangeOtp(input: {
  userId: string;
  challengeId: string;
  code: string;
}) {
  const challenge = await prisma.passwordChangeOtp.findUnique({
    where: { id: input.challengeId },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      attempts: true,
      maxAttempts: true,
      expiresAt: true,
      verifiedAt: true,
      usedAt: true,
      invalidatedAt: true,
    },
  });

  if (!challenge || challenge.userId !== input.userId || challenge.invalidatedAt || challenge.usedAt) {
    throw new PasswordChangeOtpError('Código inválido ou expirado.', 'CHALLENGE_NOT_FOUND');
  }

  const now = new Date();
  if (challenge.expiresAt <= now) {
    await prisma.passwordChangeOtp.updateMany({
      where: { id: challenge.id, invalidatedAt: null },
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
    await prisma.passwordChangeOtp.updateMany({
      where: {
        id: challenge.id,
        userId: input.userId,
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
  const claimed = await prisma.passwordChangeOtp.updateMany({
    where: {
      id: challenge.id,
      userId: input.userId,
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
}

export async function completePasswordChange(input: {
  userId: string;
  challengeId: string;
  verificationToken: string;
  newPassword: string;
  revokeAllSessions: boolean;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
}) {
  assertPasswordPolicy(input.newPassword);

  const challenge = await prisma.passwordChangeOtp.findUnique({
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
    },
  });

  const now = new Date();
  if (
    !challenge ||
    challenge.userId !== input.userId ||
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

  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { id: true, contaId: true, status: true },
  });
  if (!user || user.status !== 'ATIVO') {
    throw new PasswordChangeOtpError('Usuário indisponível.', 'USER_UNAVAILABLE', 404);
  }

  const senhaHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordChangeOtp.updateMany({
      where: {
        id: challenge.id,
        userId: input.userId,
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

    await tx.usuario.update({
      where: { id: user.id },
      data: { senhaHash, passwordChangedAt: now },
    });

    if (input.revokeAllSessions) {
      await revokeUserSessions(user.id, tx);
    }
  });

  try {
    await auditLogService.record({
      contaId: user.contaId,
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
    console.error('[auth][password-change-otp][audit-failed]', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, revokedAllSessions: input.revokeAllSessions };
}
