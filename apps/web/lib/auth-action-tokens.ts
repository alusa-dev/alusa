import { randomBytes, createHash } from 'node:crypto';
import type { AuthActionTokenType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const expiryByType: Record<AuthActionTokenType, number> = {
  VERIFY_EMAIL: Number(process.env.AUTH_VERIFY_EMAIL_TTL_MINUTES || 60 * 24),
  RESET_PASSWORD: Number(process.env.AUTH_RESET_PASSWORD_TTL_MINUTES || 60),
};

export type CreateAuthActionTokenInput = {
  userId: string;
  email: string;
  type: AuthActionTokenType;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
};

export type ConsumeAuthActionTokenResult = {
  tokenId: string;
  user: {
    id: string;
    contaId: string;
    email: string;
    nome: string;
    emailVerifiedAt: Date | null;
  };
};

export type AuthActionTokenLookupResult = {
  tokenId: string;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    contaId: string;
    email: string;
    nome: string;
    emailVerifiedAt: Date | null;
  };
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiresAtFor(type: AuthActionTokenType): Date {
  return new Date(Date.now() + expiryByType[type] * 60 * 1000);
}

export function getAuthActionTokenExpiryLabel(type: AuthActionTokenType): string {
  const ttlMinutes = expiryByType[type];
  if (ttlMinutes % (60 * 24) === 0) {
    const days = ttlMinutes / (60 * 24);
    return days === 1 ? '1 dia' : `${String(days)} dias`;
  }

  if (ttlMinutes % 60 === 0) {
    const hours = ttlMinutes / 60;
    return hours === 1 ? '1 hora' : `${String(hours)} horas`;
  }

  return `${String(ttlMinutes)} minutos`;
}

export async function createAuthActionToken(input: CreateAuthActionTokenInput) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = expiresAtFor(input.type);

  const created = await prisma.$transaction(async (tx) => {
    await tx.authActionToken.updateMany({
      where: {
        userId: input.userId,
        type: input.type,
        usedAt: null,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });

    return tx.authActionToken.create({
      data: {
        userId: input.userId,
        type: input.type,
        tokenHash,
        email: input.email,
        expiresAt,
        requestedByIp: input.requestedByIp ?? null,
        requestedByUserAgent: input.requestedByUserAgent ?? null,
      },
    });
  });

  return { token, record: created };
}

export async function markAuthActionTokenEmailSent(
  tokenId: string,
  resendEmailId: string | null,
): Promise<void> {
  await prisma.authActionToken.update({
    where: { id: tokenId },
    data: { resendEmailId },
  });
}

export async function consumeAuthActionToken(
  type: AuthActionTokenType,
  plainToken: string,
): Promise<ConsumeAuthActionTokenResult | null> {
  const tokenHash = hashToken(plainToken);

  return prisma.$transaction(async (tx) => {
    const token = await tx.authActionToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            contaId: true,
            email: true,
            nome: true,
            emailVerifiedAt: true,
          },
        },
      },
    });

    if (!token || token.type !== type || token.usedAt || token.invalidatedAt) {
      return null;
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      await tx.authActionToken.update({
        where: { id: token.id },
        data: { invalidatedAt: new Date() },
      });
      return null;
    }

    await tx.authActionToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return {
      tokenId: token.id,
      user: token.user,
    };
  });
}

export async function findAuthActionTokenByPlainToken(
  type: AuthActionTokenType,
  plainToken: string,
): Promise<AuthActionTokenLookupResult | null> {
  const tokenHash = hashToken(plainToken);

  const token = await prisma.authActionToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          contaId: true,
          email: true,
          nome: true,
          emailVerifiedAt: true,
        },
      },
    },
  });

  if (!token || token.type !== type) {
    return null;
  }

  return {
    tokenId: token.id,
    usedAt: token.usedAt,
    invalidatedAt: token.invalidatedAt,
    expiresAt: token.expiresAt,
    user: token.user,
  };
}

export async function invalidateAuthActionTokens(
  userId: string,
  type: AuthActionTokenType,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await db.authActionToken.updateMany({
    where: {
      userId,
      type,
      usedAt: null,
      invalidatedAt: null,
    },
    data: {
      invalidatedAt: new Date(),
    },
  });
}
