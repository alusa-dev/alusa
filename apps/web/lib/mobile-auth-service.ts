import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

import prisma from '@/lib/prisma';
import { listAuthContextAccounts, resolveSessionAccess, verifyCredentialsDetailed, type AuthContext } from '@/lib/auth-service';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const mobileAuthSecret = () => {
  const configuredSecret = process.env.MOBILE_AUTH_SECRET?.trim();
  const value = configuredSecret || (process.env.NODE_ENV === 'production' ? '' : process.env.NEXTAUTH_SECRET?.trim());
  if (!value) throw new Error('MOBILE_AUTH_SECRET ou NEXTAUTH_SECRET ausente.');
  return new TextEncoder().encode(value);
};

const issuer = process.env.MOBILE_AUTH_ISSUER?.trim() || 'alusa-mobile';
const audience = process.env.MOBILE_AUTH_AUDIENCE?.trim() || 'alusa-mobile-api';

export const mobileLoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256),
  authContext: z.enum(['OWNER', 'COLLABORATOR', 'PORTAL']).default('COLLABORATOR'),
  contaId: z.string().trim().min(1).max(191).optional().nullable(),
  deviceId: z.string().trim().min(1).max(128).optional().nullable(),
  deviceName: z.string().trim().min(1).max(128).optional().nullable(),
});

export const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
  contaId: z.string().trim().min(1).max(191).optional().nullable(),
  deviceId: z.string().trim().min(1).max(128).optional().nullable(),
  deviceName: z.string().trim().min(1).max(128).optional().nullable(),
});

export type MobileAuthMetadata = {
  ip?: string | null;
  userAgent?: string | null;
};

export class MobileAuthError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'INVALID_CREDENTIALS'
      | 'EMAIL_NOT_VERIFIED'
      | 'ACCOUNT_UNAVAILABLE'
      | 'SESSION_REVOKED'
      | 'ACCOUNT_SELECTION_REQUIRED',
    public readonly accounts?: Array<{ id: string; name: string }>,
  ) {
    super(code);
    this.name = 'MobileAuthError';
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function hashMetadata(value?: string | null) {
  return value ? hashToken(value).slice(0, 64) : null;
}

function normalizeOptional(value?: string | null) {
  const normalized = value?.trim();
  return normalized || null;
}

type MobileMembership = {
  contaId: string;
  role: string;
  conta: { id: string; nome: string; status: string; deletedAt: Date | null };
};

function selectMembership(memberships: MobileMembership[], preferredContaId?: string | null) {
  const preferred = normalizeOptional(preferredContaId);
  if (preferred) {
    const match = memberships.find((membership) => membership.contaId === preferred);
    if (!match) throw new MobileAuthError('ACCOUNT_UNAVAILABLE');
    return match;
  }
  return memberships[0] ?? null;
}

function publicUser(
  user: { id: string; email: string; nome: string; foto?: string | null; telefone?: string | null; birthDate?: Date | null; emailVerifiedAt: Date | null },
  memberships: MobileMembership[],
  active: MobileMembership,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.nome,
    foto: user.foto ?? null,
    telefone: user.telefone ?? null,
    birthDate: user.birthDate?.toISOString() ?? null,
    role: active.role,
    contaId: active.contaId,
    emailVerified: Boolean(user.emailVerifiedAt),
    accountActive: true,
    contas: memberships.map((membership) => ({
      id: membership.contaId,
      nome: membership.conta.nome,
      role: membership.role,
    })),
  };
}

async function createAccessToken(input: {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  contaId: string;
  role: string;
  authContext: AuthContext;
}) {
  return new SignJWT({
    sid: input.sessionId,
    sv: input.sessionVersion,
    contaId: input.contaId,
    role: input.role,
    authContext: input.authContext,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(mobileAuthSecret());
}

async function createSession(input: {
  userId: string;
  sessionVersion: number;
  contaId: string;
  role: string;
  authContext: AuthContext;
  deviceId?: string | null;
  deviceName?: string | null;
  metadata: MobileAuthMetadata;
}) {
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await prisma.mobileAuthSession.create({
    data: {
      userId: input.userId,
      authContext: input.authContext,
      activeContaId: input.contaId,
      tokenHash: hashToken(refreshToken),
      deviceId: normalizeOptional(input.deviceId),
      deviceName: normalizeOptional(input.deviceName),
      ipHash: hashMetadata(input.metadata.ip),
      userAgent: normalizeOptional(input.metadata.userAgent),
      expiresAt,
    },
  });

  const accessToken = await createAccessToken({
    userId: input.userId,
    sessionId: session.id,
    sessionVersion: input.sessionVersion,
    contaId: input.contaId,
    role: input.role,
    authContext: input.authContext,
  });

  return { accessToken, refreshToken, expiresAt };
}

export async function loginMobile(
  input: z.input<typeof mobileLoginSchema>,
  metadata: MobileAuthMetadata = {},
) {
  const parsed = mobileLoginSchema.safeParse(input);
  if (!parsed.success) throw new MobileAuthError('INVALID_INPUT');

  const result = await verifyCredentialsDetailed(parsed.data.email, parsed.data.password, parsed.data.authContext, parsed.data.contaId);
  if (!result.ok) {
    throw new MobileAuthError(
      result.reason === 'ACCOUNT_UNAVAILABLE' || result.reason === 'ACCOUNT_DEACTIVATED'
        ? 'ACCOUNT_UNAVAILABLE'
        : 'INVALID_CREDENTIALS',
    );
  }
  if (!result.user.emailVerifiedAt) throw new MobileAuthError('EMAIL_NOT_VERIFIED');

  if (!parsed.data.contaId && result.user.availableAccounts.length > 1) {
    throw new MobileAuthError('ACCOUNT_SELECTION_REQUIRED', result.user.availableAccounts.map(({ id, name }) => ({ id, name })));
  }
  const memberships: MobileMembership[] = result.user.availableAccounts.map((account) => ({
    contaId: account.id,
    role: account.role ?? (parsed.data.authContext === 'PORTAL' ? 'RESPONSAVEL' : 'ADMIN'),
    conta: { id: account.id, nome: account.name, status: 'ATIVO', deletedAt: null },
  }));
  const active = selectMembership(memberships, parsed.data.contaId);
  if (!active) throw new MobileAuthError('ACCOUNT_UNAVAILABLE');

  const tokens = await createSession({
    userId: result.user.id,
    sessionVersion: result.user.sessionVersion,
    contaId: active.contaId,
    role: active.role,
    authContext: parsed.data.authContext,
    deviceId: parsed.data.deviceId,
    deviceName: parsed.data.deviceName,
    metadata,
  });

  if (parsed.data.authContext === 'COLLABORATOR') await prisma.usuarioConta.updateMany({
    where: { usuarioId: result.user.id, contaId: active.contaId, status: 'ATIVO' }, data: { lastAccessedAt: new Date() },
  });

  return {
    version: 1 as const,
    ...tokens,
    user: publicUser(result.user, memberships, active),
    activeContaId: active.contaId,
  };
}

export async function refreshMobileSession(
  input: z.input<typeof mobileRefreshSchema>,
  metadata: MobileAuthMetadata = {},
) {
  const parsed = mobileRefreshSchema.safeParse(input);
  if (!parsed.success) throw new MobileAuthError('INVALID_INPUT');

  const oldSession = await prisma.mobileAuthSession.findUnique({
    where: { tokenHash: hashToken(parsed.data.refreshToken) },
    select: {
      id: true,
      userId: true,
      authContext: true,
      activeContaId: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          nome: true,
          foto: true,
          telefone: true,
          birthDate: true,
          emailVerifiedAt: true,
          sessionVersion: true,
          status: true,
        },
      },
    },
  });

  if (
    !oldSession ||
    oldSession.revokedAt ||
    oldSession.expiresAt.getTime() <= Date.now() ||
    oldSession.user.status !== 'ATIVO'
  ) {
    throw new MobileAuthError('SESSION_REVOKED');
  }

  const credential = await prisma.authCredential.findUnique({
    where: { uq_auth_credential_context_user: { context: oldSession.authContext, userId: oldSession.userId } },
    select: { sessionVersion: true, emailVerifiedAt: true },
  });
  if (!credential) throw new MobileAuthError('SESSION_REVOKED');

  const access = await resolveSessionAccess({
    userId: oldSession.userId,
    contaId: parsed.data.contaId ?? oldSession.activeContaId,
    sessionVersion: credential.sessionVersion,
    authContext: oldSession.authContext,
  });
  if (!access.ok) throw new MobileAuthError('SESSION_REVOKED');
  if (!access.emailVerified) throw new MobileAuthError('EMAIL_NOT_VERIFIED');

  const memberships: MobileMembership[] = (await listAuthContextAccounts(oldSession.user.id, oldSession.authContext)).map((account) => ({
    contaId: account.id,
    role: 'role' in account && typeof account.role === 'string' ? account.role : access.role,
    conta: { id: account.id, nome: account.name, status: 'ATIVO', deletedAt: null },
  }));
  const active = selectMembership(memberships, access.contaId);
  if (!active) throw new MobileAuthError('ACCOUNT_UNAVAILABLE');

  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const newSession = await prisma.$transaction(async (tx) => {
    const revoked = await tx.mobileAuthSession.updateMany({
      where: { id: oldSession.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (revoked.count !== 1) throw new MobileAuthError('SESSION_REVOKED');

    return tx.mobileAuthSession.create({
      data: {
        userId: oldSession.userId,
        authContext: oldSession.authContext,
        activeContaId: active.contaId,
        tokenHash: hashToken(refreshToken),
        deviceId: normalizeOptional(parsed.data.deviceId),
        deviceName: normalizeOptional(parsed.data.deviceName),
        ipHash: hashMetadata(metadata.ip),
        userAgent: normalizeOptional(metadata.userAgent),
        expiresAt,
      },
    });
  });

  const accessToken = await createAccessToken({
    userId: oldSession.userId,
    sessionId: newSession.id,
    sessionVersion: credential.sessionVersion,
    contaId: active.contaId,
    role: active.role,
    authContext: oldSession.authContext,
  });

  return {
    version: 1 as const,
    accessToken,
    refreshToken,
    expiresAt,
    user: publicUser({ ...oldSession.user, emailVerifiedAt: credential.emailVerifiedAt }, memberships, active),
    activeContaId: active.contaId,
  };
}

export async function revokeMobileSession(refreshToken?: string | null) {
  const normalized = refreshToken?.trim();
  if (!normalized) return;
  await prisma.mobileAuthSession.updateMany({
    where: { tokenHash: hashToken(normalized), revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
}

export async function verifyMobileAccessToken(token: string): Promise<{
  userId: string;
  sessionId: string;
  sessionVersion: number;
  contaId: string;
  role: string;
  authContext: AuthContext;
} | null> {
  try {
    const { payload } = await jwtVerify(token, mobileAuthSecret(), { issuer, audience });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
    const sessionVersion = typeof payload.sv === 'number' ? payload.sv : null;
    const contaId = typeof payload.contaId === 'string' ? payload.contaId : null;
    const authContext = payload.authContext === 'OWNER' || payload.authContext === 'PORTAL' || payload.authContext === 'COLLABORATOR' ? payload.authContext : null;
    if (!userId || !sessionId || sessionVersion === null || !contaId || !authContext) return null;

    const session = await prisma.mobileAuthSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, authContext: true, expiresAt: true, revokedAt: true, user: { select: { status: true } } },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status !== 'ATIVO' ||
      session.authContext !== authContext
    ) return null;

    const access = await resolveSessionAccess({ userId, contaId, sessionVersion, authContext });
    if (!access.ok || access.contaId !== contaId || !access.emailVerified) return null;

    await prisma.mobileAuthSession.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
    return { userId, sessionId, sessionVersion, contaId, role: access.role, authContext };
  } catch {
    return null;
  }
}

export function mobileAuthErrorStatus(error: unknown) {
  if (!(error instanceof MobileAuthError)) return 500;
  if (error.code === 'INVALID_INPUT') return 400;
  if (error.code === 'EMAIL_NOT_VERIFIED') return 403;
  if (error.code === 'ACCOUNT_SELECTION_REQUIRED') return 409;
  return 401;
}
