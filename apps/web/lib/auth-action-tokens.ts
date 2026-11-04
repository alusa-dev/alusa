import { randomBytes, createHash } from 'node:crypto';
import type { AuthActionTokenType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthContext } from './auth-service';

const expiryByType: Record<AuthActionTokenType, number> = {
  VERIFY_EMAIL: Number(process.env.AUTH_VERIFY_EMAIL_TTL_MINUTES || 60 * 24),
  RESET_PASSWORD: Number(process.env.AUTH_RESET_PASSWORD_TTL_MINUTES || 60),
  ACCOUNT_REACTIVATION: Number(process.env.AUTH_ACCOUNT_REACTIVATION_TTL_MINUTES || 60),
};

export type CreateAuthActionTokenInput = {
  userId: string;
  email: string;
  type: AuthActionTokenType;
  context?: AuthContext | null;
  requestedByIp?: string | null;
  requestedByUserAgent?: string | null;
};

export type ConsumeAuthActionTokenResult = {
  tokenId: string;
  user: {
    id: string;
    contaId: string | null;
    email: string;
    nome: string;
    emailVerifiedAt: Date | null;
  };
  context: AuthContext | null;
};

export type AuthActionTokenLookupResult = {
  tokenId: string;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    contaId: string | null;
    email: string;
    nome: string;
    emailVerifiedAt: Date | null;
  };
  context: AuthContext | null;
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
        ...(input.context ? { context: input.context } : {}),
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
        context: input.context ?? null,
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
  db?: Prisma.TransactionClient,
): Promise<ConsumeAuthActionTokenResult | null> {
  const tokenHash = hashToken(plainToken);

  const consume = async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.authActionToken.updateMany({
      where: {
        tokenHash,
        type,
        usedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (claimed.count !== 1) {
      await tx.authActionToken.updateMany({
        where: {
          tokenHash,
          type,
          usedAt: null,
          invalidatedAt: null,
          expiresAt: { lte: new Date() },
        },
        data: { invalidatedAt: new Date() },
      });
      return null;
    }

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

    if (!token || token.type !== type || token.invalidatedAt) {
      return null;
    }

    return {
      tokenId: token.id,
      user: token.user,
      context: token.context,
    };
  };

  return db ? consume(db) : prisma.$transaction(consume);
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
    context: token.context,
  };
}

export async function invalidateAuthActionTokens(
  userId: string,
  type: AuthActionTokenType,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  context?: AuthContext | null,
): Promise<void> {
  await db.authActionToken.updateMany({
    where: {
      userId,
      type,
      ...(context ? { context } : {}),
      usedAt: null,
      invalidatedAt: null,
    },
    data: {
      invalidatedAt: new Date(),
    },
  });
}
