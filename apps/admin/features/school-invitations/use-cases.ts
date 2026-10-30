import { createHash, createHmac } from 'node:crypto';
import type { prisma } from '@alusa/database';
import { createCustomInvitationPrice, InvitationStripePriceError, type CustomInvitationPriceInput } from './custom-price';
import { sendSchoolInvitationEmail } from './email';
import type { invitationCreateSchema, invitationUpdateSchema } from './schemas';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing/commercial-model';

type Database = typeof prisma;
type CreateInput = Omit<ReturnType<typeof invitationCreateSchema.parse>, 'expirationHours'>;
type UpdateInput = ReturnType<typeof invitationUpdateSchema.parse>;
type CreatePrice = (input: CustomInvitationPriceInput) => ReturnType<typeof createCustomInvitationPrice>;
type SendEmail = typeof sendSchoolInvitationEmail;
type EmailDeliveryResult = {
  emailDeliveryStatus: string;
  emailDeliveryErrorCode: string | null;
  stale?: boolean;
  url?: string | null;
  expiresAt?: Date | null;
};

export class SchoolInvitationUseCaseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function listCommercialSchoolInvitations(db: Database) {
  return db.platformSchoolInvitation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, schoolName: true, contactName: true, email: true, conditionType: true,
      planCode: true, monthlyAmountCents: true, studentCount: true, trialDays: true,
      expiresAt: true, status: true, acceptedAt: true, acceptedContaId: true, createdAt: true,
    },
  });
}

export async function getCommercialSchoolInvitation(db: Database, id: string) {
  return db.platformSchoolInvitation.findUnique({
    where: { id },
    include: { history: { orderBy: { createdAt: 'desc' } } },
  });
}

const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
const requestKeyFingerprint = (requestKey: string) => createHash('sha256').update(requestKey).digest('hex');
const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

async function deliverInvitationEmail(input: {
  db: Database;
  invitationId: string;
  actorId: string;
  tokenHash: string;
  requestKeyField: 'requestIdempotencyKey' | 'emailResendRequestKey';
  requestKey: string;
  url: string;
  baseUrl: string;
  email: string;
  schoolName: string;
  expiresAt: Date;
  sendEmail?: SendEmail;
}): Promise<EmailDeliveryResult> {
  let deliveryOutcome: { status: string; sentAt: Date | null; errorCode: string | null };
  try {
    const delivery = await (input.sendEmail ?? sendSchoolInvitationEmail)({
      id: input.invitationId, tokenHash: input.tokenHash, url: input.url, email: input.email,
      schoolName: input.schoolName, expiresAt: input.expiresAt,
    });
    deliveryOutcome = { status: delivery.status, sentAt: delivery.sentAt, errorCode: null };
  } catch (error) {
    const ambiguous = error instanceof Error && 'code' in error && error.code === 'EMAIL_DELIVERY_AMBIGUOUS';
    deliveryOutcome = {
      status: ambiguous ? 'UNKNOWN' : 'FAILED', sentAt: null,
      errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'EMAIL_DELIVERY_FAILED',
    };
  }

  try {
    const persisted = await persistInvitationEmailOutcome(input, deliveryOutcome);
    if (!persisted) return currentDeliveryOutcome({ ...input, attemptedStatus: deliveryOutcome.status });
    return { emailDeliveryStatus: deliveryOutcome.status, emailDeliveryErrorCode: deliveryOutcome.errorCode };
  } catch {
    const fallback = { status: 'UNKNOWN', sentAt: null, errorCode: 'EMAIL_DELIVERY_STATE_PERSIST_FAILED' };
    logEmailDeliveryPersistenceFailure(input.invitationId);
    try {
      const persisted = await persistInvitationEmailOutcome(input, fallback);
      if (!persisted) return currentDeliveryOutcome({ ...input, attemptedStatus: deliveryOutcome.status });
    } catch {
      logEmailDeliveryPersistenceFailure(input.invitationId);
      const latest = await currentDeliveryOutcome({ ...input, attemptedStatus: deliveryOutcome.status });
      if (latest.stale) return latest;
    }
    return { emailDeliveryStatus: fallback.status, emailDeliveryErrorCode: fallback.errorCode };
  }
}

async function persistInvitationEmailOutcome(
  input: { db: Database; invitationId: string; actorId: string; tokenHash: string; requestKeyField: 'requestIdempotencyKey' | 'emailResendRequestKey'; requestKey: string },
  outcome: { status: string; sentAt: Date | null; errorCode: string | null },
) {
  const action = outcome.status === 'SENT' || outcome.status === 'SKIPPED'
    ? `EMAIL_${outcome.status}`
    : outcome.status === 'UNKNOWN' ? 'EMAIL_DELIVERY_UNKNOWN' : 'EMAIL_DELIVERY_FAILED';
  return input.db.$transaction(async (tx) => {
    const updated = await tx.platformSchoolInvitation.updateMany({
      where: { id: input.invitationId, tokenHash: input.tokenHash, [input.requestKeyField]: input.requestKey },
      data: {
        emailDeliveryStatus: outcome.status, emailSentAt: outcome.sentAt,
        emailDeliveryErrorCode: outcome.errorCode,
      },
    });
    if (updated.count !== 1) return false;
    await tx.platformSchoolInvitationHistory.create({
      data: {
        invitationId: input.invitationId, actorId: input.actorId, action,
        after: {
          emailDeliveryStatus: outcome.status,
          emailDeliveryErrorCode: outcome.errorCode,
          requestKeyFingerprint: requestKeyFingerprint(input.requestKey).slice(0, 24),
        },
      },
    });
    return true;
  });
}

async function currentDeliveryOutcome(input: {
  db: Database; invitationId: string; actorId: string; tokenHash: string;
  requestKeyField: 'requestIdempotencyKey' | 'emailResendRequestKey';
  requestKey: string; attemptedStatus: string; baseUrl: string; url: string;
}): Promise<EmailDeliveryResult> {
  const current = await input.db.platformSchoolInvitation.findUnique({
    where: { id: input.invitationId },
    select: {
      status: true, tokenHash: true, requestIdempotencyKey: true, emailResendRequestKey: true,
      emailDeliveryStatus: true, emailDeliveryErrorCode: true, expiresAt: true,
    },
  });
  const currentRequestKey = input.requestKeyField === 'emailResendRequestKey' ? current?.emailResendRequestKey : current?.requestIdempotencyKey;
  const stale = !current || current.tokenHash !== input.tokenHash || currentRequestKey !== input.requestKey;
  if (stale) {
    await input.db.$transaction(async (tx) => tx.platformSchoolInvitationHistory.create({
      data: {
        invitationId: input.invitationId,
        actorId: input.actorId,
        action: 'EMAIL_DELIVERY_STALE',
        after: {
        requestKeyFingerprint: requestKeyFingerprint(input.requestKey).slice(0, 24),
          attemptedDeliveryStatus: input.attemptedStatus,
        },
      },
    })).catch(() => logEmailDeliveryPersistenceFailure(input.invitationId));
  }
  const activeLink = current?.emailResendRequestKey && current.status === 'PENDING'
    ? `${input.baseUrl}/convite-escola/${createResendToken(input.invitationId, current.emailResendRequestKey)}`
    : !stale ? input.url : null;
  return {
    emailDeliveryStatus: stale ? current?.emailDeliveryStatus ?? 'UNKNOWN' : 'UNKNOWN',
    emailDeliveryErrorCode: stale ? current?.emailDeliveryErrorCode ?? 'EMAIL_DELIVERY_STATE_STALE' : 'EMAIL_DELIVERY_STATE_PERSIST_FAILED',
    stale,
    url: activeLink,
    expiresAt: current?.expiresAt ?? null,
  };
}

function logEmailDeliveryPersistenceFailure(invitationId: string) {
  console.error(JSON.stringify({ event: 'admin.school_invitation.email_delivery_state_persist_failed', invitationId }));
}

function createResendToken(invitationId: string, requestKey: string) {
  const secret = process.env.SCHOOL_INVITATION_RESEND_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new SchoolInvitationUseCaseError('RESEND_TOKEN_SECRET_UNAVAILABLE', 'A chave segura de reenvio de convites não está configurada.');
  }
  const signingKey = createHmac('sha256', secret).update('alusa:school-invitation-resend:v1').digest();
  return createHmac('sha256', signingKey).update(`${invitationId}\0${requestKey}`).digest('base64url');
}

export async function findReusableSchoolInvitation(db: Database, requestIdempotencyKey: string) {
  const existing = await db.platformSchoolInvitation.findUnique({
    where: { requestIdempotencyKey },
    select: { id: true, status: true, emailDeliveryStatus: true, expiresAt: true },
  });
  return existing ? { ...existing, reused: true, requiresResend: true } : null;
}

export async function createCommercialSchoolInvitation(input: {
  db: Database;
  data: CreateInput;
  requestIdempotencyKey: string;
  token: string;
  expiresAt: Date;
  createdByAdminId: string;
  baseUrl: string;
  createPrice?: CreatePrice;
  sendEmail?: SendEmail;
}) {
  const { db, data, requestIdempotencyKey, token, expiresAt, createdByAdminId } = input;
  const existing = await findReusableSchoolInvitation(db, requestIdempotencyKey);
  if (existing) return { kind: 'reused' as const, data: existing };

  const target = data.conditionType === 'STANDARD' ? resolveSchoolCommercialTarget(data.studentCount) : null;
  if (data.conditionType === 'STANDARD' && (!target || target.kind !== 'SELF_SERVICE')) {
    return { kind: 'invalid' as const, message: 'Acima de 500 alunos, use condição personalizada e atendimento especializado.' };
  }
  const normalizedData = {
    ...data,
    planCode: data.conditionType === 'STANDARD' && target?.kind === 'SELF_SERVICE' ? target.band.code : null,
  };

  const invitationId = `school_invitation_${createHash('sha256').update(requestIdempotencyKey).digest('hex').slice(0, 32)}`;
  let customPrice: Awaited<ReturnType<CreatePrice>> | null = null;
  if (data.conditionType === 'CUSTOM') {
    try {
      customPrice = await (input.createPrice ?? createCustomInvitationPrice)({
        invitationId,
        version: 1,
        schoolName: normalizedData.schoolName,
        studentCount: normalizedData.studentCount,
        baseMonthlyAmountCents: normalizedData.customBaseMonthlyAmountCents!,
        includedStudentCount: normalizedData.customIncludedStudentCount!,
        monthlyPerStudentOverageCents: normalizedData.customMonthlyOverageAmountCents!,
      });
    } catch (error) {
      if (error instanceof InvitationStripePriceError) throw error;
      throw new InvitationStripePriceError('PLATFORM_PRICE_UNAVAILABLE', 'Não foi possível criar o Price recorrente.');
    }
  }

  const invitationData = {
    ...normalizedData,
    id: invitationId,
    monthlyAmountCents: customPrice?.monthlyAmountCents ?? null,
    stripePriceId: customPrice?.stripePriceId ?? null,
    stripeProductId: customPrice?.stripeProductId ?? null,
  };
  let row;
  try {
    row = await db.$transaction(async (tx) => {
      const invitation = await tx.platformSchoolInvitation.create({
        data: { ...invitationData, requestIdempotencyKey, tokenHash: tokenDigest(token), expiresAt, createdByAdminId },
      });
      const snapshot = conditionSnapshot(normalizedData, invitationData);
      await tx.platformSchoolInvitationConditionVersion.create({ data: { invitationId: invitation.id, version: 1, createdBy: createdByAdminId, snapshot } });
      await tx.platformSchoolInvitationHistory.create({
        data: { invitationId: invitation.id, actorId: createdByAdminId, action: 'CREATED', after: { schoolName: normalizedData.schoolName, email: normalizedData.email, ...snapshot, expiresAt: expiresAt.toISOString() } },
      });
      return invitation;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db.platformSchoolInvitation.findUnique({
        where: { requestIdempotencyKey },
        select: { id: true, status: true, emailDeliveryStatus: true, expiresAt: true },
      });
      if (raced) return { kind: 'reused' as const, data: { ...raced, reused: true, requiresResend: true } };
    }
    throw error;
  }

  const invitationUrl = `${input.baseUrl}/convite-escola/${token}`;
  const delivery = await deliverInvitationEmail({
    db, invitationId: row.id, actorId: createdByAdminId, tokenHash: tokenDigest(token), url: invitationUrl,
    requestKeyField: 'requestIdempotencyKey', requestKey: requestIdempotencyKey, baseUrl: input.baseUrl,
    email: row.email, schoolName: row.schoolName, expiresAt, sendEmail: input.sendEmail,
  });
  return { kind: 'created' as const, data: { id: row.id, url: delivery.url ?? (delivery.stale ? null : invitationUrl), expiresAt, ...delivery } };
}

export async function resendCommercialSchoolInvitation(input: {
  db: Database;
  id: string;
  actorId: string;
  requestKey: string;
  baseUrl: string;
  now?: Date;
  sendEmail?: SendEmail;
}) {
  const now = input.now ?? new Date();
  const current = await input.db.platformSchoolInvitation.findUnique({ where: { id: input.id } });
  if (!current) return { kind: 'not_found' as const };
  if (current.status !== 'PENDING') return { kind: 'conflict' as const, reason: 'NOT_PENDING' };
  if (current.emailResendRequestKey === input.requestKey) {
    const token = createResendToken(input.id, input.requestKey);
    return { kind: 'reused' as const, data: { reused: true, url: `${input.baseUrl}/convite-escola/${token}`, expiresAt: current.expiresAt, emailDeliveryStatus: current.emailDeliveryStatus } };
  }
  const fingerprint = requestKeyFingerprint(input.requestKey);
  const priorRequest = await input.db.platformSchoolInvitationResendRequest.findUnique({
    where: { invitationId_requestKeyFingerprint: { invitationId: input.id, requestKeyFingerprint: fingerprint } },
    select: { invitationId: true },
  });
  if (priorRequest) {
    const activeToken = current.emailResendRequestKey ? createResendToken(input.id, current.emailResendRequestKey) : null;
    return {
      kind: 'reused' as const,
      data: {
        reused: true, stale: true,
        url: current.status === 'PENDING' && activeToken ? `${input.baseUrl}/convite-escola/${activeToken}` : null,
        expiresAt: current.expiresAt, emailDeliveryStatus: current.emailDeliveryStatus,
      },
    };
  }
  if (current.emailResentAt && now.getTime() - current.emailResentAt.getTime() < 60_000) return { kind: 'rate_limited' as const };

  const token = createResendToken(input.id, input.requestKey);
  const tokenHash = tokenDigest(token);
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const claimed = await input.db.$transaction(async (tx) => {
    const update = await tx.platformSchoolInvitation.updateMany({
      where: { id: input.id, status: 'PENDING', emailResentAt: current.emailResentAt },
      data: {
        tokenHash, expiresAt, emailResendRequestKey: input.requestKey, emailResentAt: now,
        emailDeliveryStatus: 'PENDING', emailSentAt: null, emailDeliveryErrorCode: null,
      },
    });
    if (update.count !== 1) return false;
    await tx.platformSchoolInvitationResendRequest.createMany({
      data: [
        ...(current.emailResendRequestKey ? [{ invitationId: input.id, requestKeyFingerprint: requestKeyFingerprint(current.emailResendRequestKey) }] : []),
        { invitationId: input.id, requestKeyFingerprint: fingerprint },
      ],
      skipDuplicates: true,
    });
    await tx.platformSchoolInvitationHistory.create({
      data: {
        invitationId: input.id, actorId: input.actorId, action: 'LINK_REISSUED',
        before: { expiresAt: current.expiresAt.toISOString() }, after: { expiresAt: expiresAt.toISOString() },
      },
    });
    return true;
  });
  if (!claimed) {
    const latest = await input.db.platformSchoolInvitation.findUnique({ where: { id: input.id } });
    if (latest?.status === 'PENDING' && latest.emailResendRequestKey) {
      const activeToken = createResendToken(input.id, latest.emailResendRequestKey);
      return { kind: 'reused' as const, data: { reused: true, url: `${input.baseUrl}/convite-escola/${activeToken}`, expiresAt: latest.expiresAt, emailDeliveryStatus: latest.emailDeliveryStatus } };
    }
    return { kind: 'reused' as const, data: { reused: true, emailDeliveryStatus: 'PENDING' } };
  }

  const url = `${input.baseUrl}/convite-escola/${token}`;
  const delivery = await deliverInvitationEmail({
    db: input.db, invitationId: input.id, actorId: input.actorId, tokenHash, url,
    requestKeyField: 'emailResendRequestKey', requestKey: input.requestKey, baseUrl: input.baseUrl,
    email: current.email, schoolName: current.schoolName, expiresAt, sendEmail: input.sendEmail,
  });
  return { kind: delivery.stale ? 'stale' as const : 'resent' as const, data: { reused: delivery.stale === true, url, expiresAt, ...delivery } };
}

export async function updateCommercialSchoolInvitation(input: {
  db: Database;
  id: string;
  actorId: string;
  changes: UpdateInput;
  createPrice?: CreatePrice;
}) {
  const { db, id, actorId, changes } = input;
  const current = await db.platformSchoolInvitation.findUnique({ where: { id } });
  if (!current) return { kind: 'not_found' as const };
  if (changes.action === 'REVOKE') return revokeInvitation({ db, id, actorId, current });
  if (changes.email !== undefined && changes.email !== current.email) {
    return { kind: 'conflict' as const, reason: 'EMAIL_IMMUTABLE', message: 'O e-mail do convite é imutável. Revogue o convite e emita outro para o endereço correto.' };
  }

  const acceptedButUnbilled = current.status === 'ACCEPTED' && current.acceptedContaId !== null;
  if (current.status !== 'PENDING' && !acceptedButUnbilled) return { kind: 'conflict' as const, reason: 'NOT_EDITABLE' };
  if (acceptedButUnbilled) {
    const identityChange = changes.schoolName !== undefined || changes.contactName !== undefined || changes.email !== undefined;
    if (identityChange) return { kind: 'conflict' as const, reason: 'IDENTITY_AFTER_ACCEPTANCE' };
    const billing = await db.platformBillingAccount.findFirst({ where: { contaId: current.acceptedContaId! }, select: { id: true } });
    if (billing) return { kind: 'conflict' as const, reason: 'BILLING_STARTED' };
  }

  const { expirationHours: _expirationHours, action: _action, ...commercialChanges } = changes;
  const next = { ...current, ...commercialChanges };
  if (next.conditionType === 'STANDARD' && next.studentCount !== null && next.studentCount > 500) return { kind: 'invalid' as const, message: 'Acima de 500 alunos, use condição personalizada e atendimento especializado.' };
  if (next.studentCount === null) return { kind: 'invalid' as const, message: 'Informe a estimativa de alunos.' };
  const standardTarget = next.conditionType === 'STANDARD' ? resolveSchoolCommercialTarget(next.studentCount) : null;
  if (next.conditionType === 'STANDARD' && (!standardTarget || standardTarget.kind !== 'SELF_SERVICE')) return { kind: 'invalid' as const, message: 'Não foi possível derivar uma faixa padrão para a estimativa informada.' };
  if (next.conditionType === 'CUSTOM' && (next.customBaseMonthlyAmountCents === null || next.customIncludedStudentCount === null || next.customMonthlyOverageAmountCents === null)) return { kind: 'invalid' as const, message: 'Informe valor base, alunos incluídos e taxa mensal por aluno excedente.' };

  const normalizedChanges = {
    ...commercialChanges,
    ...(next.conditionType === 'STANDARD' && standardTarget?.kind === 'SELF_SERVICE' ? { planCode: standardTarget.band.code } : {}),
  };
  const updateData = {
    ...normalizedChanges,
    ...(next.conditionType === 'STANDARD' ? { monthlyAmountCents: null, customBaseMonthlyAmountCents: null, customIncludedStudentCount: null, customMonthlyOverageAmountCents: null, stripePriceId: null, stripeProductId: null } : {}),
    ...(next.conditionType === 'CUSTOM' ? { planCode: null } : {}),
    ...(changes.expirationHours ? { expiresAt: new Date(Date.now() + changes.expirationHours * 60 * 60 * 1000) } : {}),
  };
  const conditionKeys = ['conditionType', 'planCode', 'studentCount', 'trialDays', 'customBaseMonthlyAmountCents', 'customIncludedStudentCount', 'customMonthlyOverageAmountCents'];
  const changesCondition = conditionKeys.some((key) => key in updateData && (updateData as Record<string, unknown>)[key] !== (current as unknown as Record<string, unknown>)[key]);
  const nextConditionVersion = changesCondition ? current.currentConditionVersion + 1 : current.currentConditionVersion;
  if (changesCondition && next.conditionType === 'CUSTOM') {
    try {
      const price = await (input.createPrice ?? createCustomInvitationPrice)({
        invitationId: id, version: nextConditionVersion, schoolName: next.schoolName, studentCount: next.studentCount,
        baseMonthlyAmountCents: next.customBaseMonthlyAmountCents!, includedStudentCount: next.customIncludedStudentCount!,
        monthlyPerStudentOverageCents: next.customMonthlyOverageAmountCents!,
      });
      Object.assign(updateData, { monthlyAmountCents: price.monthlyAmountCents, stripePriceId: price.stripePriceId, stripeProductId: price.stripeProductId });
    } catch (error) {
      if (error instanceof InvitationStripePriceError) throw error;
      throw new InvitationStripePriceError('PLATFORM_PRICE_UNAVAILABLE', 'Não foi possível criar o Price recorrente.');
    }
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const guarded = await tx.platformSchoolInvitation.updateMany({
        where: { id, status: current.status, currentConditionVersion: current.currentConditionVersion },
        data: { ...updateData, ...(changesCondition ? { currentConditionVersion: nextConditionVersion } : {}) },
      });
      if (guarded.count !== 1) throw new SchoolInvitationUseCaseError('INVITATION_CHANGED_CONCURRENTLY', 'O convite foi atualizado em outra operação. Recarregue os dados e tente novamente.');
      const result = await tx.platformSchoolInvitation.findUniqueOrThrow({ where: { id } });
      if (changesCondition) {
        if (acceptedButUnbilled) {
          const billing = await tx.platformBillingAccount.findFirst({ where: { contaId: current.acceptedContaId! }, select: { id: true } });
          if (billing) throw new SchoolInvitationUseCaseError('INVITATION_BILLING_ALREADY_STARTED', 'O billing já foi iniciado. Use o fluxo de alteração de plano.');
        }
        const snapshot = conditionSnapshot(result, result);
        await tx.platformSchoolInvitationConditionVersion.create({ data: { invitationId: id, version: nextConditionVersion, createdBy: actorId, snapshot } });
      }
      const before = {
        schoolName: current.schoolName, contactName: current.contactName, email: current.email, conditionType: current.conditionType,
        planCode: current.planCode, monthlyAmountCents: current.monthlyAmountCents, studentCount: current.studentCount,
        trialDays: current.trialDays, expiresAt: current.expiresAt.toISOString(),
      };
      await tx.platformSchoolInvitationHistory.create({
        data: { invitationId: id, actorId, action: 'UPDATED', before, after: { ...Object.fromEntries(Object.entries(updateData).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) } },
      });
      if (changesCondition) await tx.platformSchoolInvitationHistory.create({
        data: { invitationId: id, actorId, action: 'CONDITION_VERSION_CREATED', before: { version: current.currentConditionVersion }, after: { version: nextConditionVersion, snapshot: conditionSnapshot(result, result) } },
      });
      return result;
    });
    return { kind: 'updated' as const, data: updated };
  } catch (error) {
    if (error instanceof SchoolInvitationUseCaseError) return { kind: 'conflict' as const, reason: error.code, message: error.message };
    throw error;
  }
}

async function revokeInvitation(input: { db: Database; id: string; actorId: string; current: { status: string } }) {
  const { db, id, actorId, current } = input;
  if (current.status !== 'PENDING') return { kind: 'conflict' as const, reason: 'NOT_PENDING' };
  const result = await db.$transaction(async (tx) => {
    const revokedAt = new Date();
    const claim = await tx.platformSchoolInvitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt } });
    if (claim.count !== 1) return null;
    const updated = await tx.platformSchoolInvitation.findUniqueOrThrow({ where: { id } });
    await tx.platformSchoolInvitationHistory.create({ data: { invitationId: id, actorId, action: 'REVOKED', before: { status: current.status }, after: { status: 'REVOKED' } } });
    return updated;
  });
  if (result) return { kind: 'revoked' as const, data: result };
  const latest = await db.platformSchoolInvitation.findUnique({ where: { id }, select: { status: true } });
  return { kind: 'conflict' as const, reason: 'CHANGED_CONCURRENTLY', currentStatus: latest?.status ?? null };
}

function conditionSnapshot(condition: {
  conditionType: string;
  planCode?: string | null;
  studentCount: number | null;
  trialDays: number;
  customBaseMonthlyAmountCents?: number | null;
  customIncludedStudentCount?: number | null;
  customMonthlyOverageAmountCents?: number | null;
}, persisted: { monthlyAmountCents: number | null; stripePriceId: string | null; stripeProductId: string | null }) {
  return {
    conditionType: condition.conditionType,
    planCode: condition.planCode ?? null,
    studentCount: condition.studentCount,
    monthlyAmountCents: persisted.monthlyAmountCents ?? null,
    customBaseMonthlyAmountCents: condition.customBaseMonthlyAmountCents ?? null,
    customIncludedStudentCount: condition.customIncludedStudentCount ?? null,
    customMonthlyOverageAmountCents: condition.customMonthlyOverageAmountCents ?? null,
    stripePriceId: persisted.stripePriceId ?? null,
    stripeProductId: persisted.stripeProductId ?? null,
    trialDays: condition.trialDays,
  };
}
