import { createHash } from 'crypto';

export type RenewalOrigin = 'CAMPAIGN' | 'STANDALONE';
export type RenewalHolderType = 'STUDENT' | 'RESPONSIBLE';
export type RenewalTargetType = 'CLASS' | 'COMBO';
export type RenewalDecision = 'RENEW' | 'DECIDE_LATER' | 'DO_NOT_CONTINUE';

export type RenewalProcessStatus =
  | 'DRAFT'
  | 'PREVIEWED'
  | 'PARTIALLY_CONFIRMED'
  | 'CONFIRMED'
  | 'WAITING_FOR_START'
  | 'REQUIRES_ATTENTION'
  | 'EFFECTIVE'
  | 'CANCELLED'
  | 'COMPLETED';

export type RenewalItemInput =
  | {
      decision: 'RENEW';
      sourceEnrollmentId: string;
      target: {
        type: RenewalTargetType;
        targetId: string;
        planId: string;
      };
    }
  | {
      decision: 'DECIDE_LATER' | 'DO_NOT_CONTINUE';
      sourceEnrollmentId: string;
      target: null;
    };

export type RenewalSourceEnrollment = {
  id: string;
  currentContractEndsAt: Date;
  updatedAt: Date;
  monthlyAmount: number;
  enrollmentFeeAmount?: number | null;
};

export type BuildRenewalPreviewInput = {
  contaId: string;
  origin: RenewalOrigin;
  campaignId?: string | null;
  targetPeriodId: string;
  targetPeriodStartsAt?: Date | null;
  holderType: RenewalHolderType;
  holderId: string;
  items: RenewalItemInput[];
  sourceEnrollments: RenewalSourceEnrollment[];
  requestedEffectiveAt?: Date | null;
  requestedFirstDueDate?: Date | null;
  enrollmentFeeAmount?: number | null;
  dependencyVersion?: string | null;
  dependencySnapshot?: Record<string, unknown> | null;
};

export type RenewalPreviewBlocker = {
  sourceEnrollmentId: string;
  code:
    | 'SOURCE_NOT_FOUND'
    | 'TARGET_REQUIRED'
    | 'TARGET_MUST_BE_NULL'
    | 'DUPLICATE_SOURCE'
    | 'INVALID_EFFECTIVE_AT'
    | 'NO_ITEMS';
  message: string;
};

export type RenewalPreview = {
  previewHash: string;
  sourceVersion: string;
  renewCount: number;
  pendingCount: number;
  nonRenewalCount: number;
  targetEnrollments: Array<{
    sourceEnrollmentId: string;
    targetType: RenewalTargetType;
    targetId: string;
    planId: string;
    effectiveAt: string;
  }>;
  reservations: Array<{
    sourceEnrollmentId: string;
    status: 'RESERVED';
    effectiveAt: string;
  }>;
  futureFinancialAgreement: {
    monthlyTotal: number;
    enrollmentFeeTotal: number;
    firstDueDate: string | null;
  } | null;
  monthlyTotal: number;
  enrollmentFeeTotal: number;
  effectiveAt: string;
  firstDueDate: string | null;
  blockers: RenewalPreviewBlocker[];
  warnings: string[];
  snapshot: Record<string, unknown>;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashSnapshot(snapshot: Record<string, unknown>) {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = toDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date) {
  return toDateOnly(date).toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateRenewalEffectiveAt(input: {
  currentContractEndsAt: Date;
  targetPeriodStartsAt?: Date | null;
  requestedEffectiveAt?: Date | null;
}): Date {
  const naturalStart = addDays(input.currentContractEndsAt, 1);
  const periodStart = input.targetPeriodStartsAt ? toDateOnly(input.targetPeriodStartsAt) : null;
  const minimum = periodStart && periodStart > naturalStart ? periodStart : naturalStart;
  if (!input.requestedEffectiveAt) return minimum;

  const requested = toDateOnly(input.requestedEffectiveAt);
  return requested > minimum ? requested : minimum;
}

export function buildRenewalSourceVersion(sourceEnrollments: RenewalSourceEnrollment[]) {
  return createHash('sha256')
    .update(
      sourceEnrollments
        .map((source) => `${source.id}:${source.updatedAt.toISOString()}`)
        .sort()
        .join('|'),
    )
    .digest('hex');
}

export function buildRenewalPreview(input: BuildRenewalPreviewInput): RenewalPreview {
  const blockers: RenewalPreviewBlocker[] = [];
  const warnings: string[] = [];
  const sourcesById = new Map(input.sourceEnrollments.map((source) => [source.id, source]));
  const seen = new Set<string>();

  if (input.items.length === 0) {
    blockers.push({
      sourceEnrollmentId: 'process',
      code: 'NO_ITEMS',
      message: 'Informe ao menos um vínculo para a rematrícula.',
    });
  }

  for (const item of input.items) {
    const runtimeItem = item as RenewalItemInput & { target?: unknown };
    if (seen.has(item.sourceEnrollmentId)) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: 'DUPLICATE_SOURCE',
        message: 'O vínculo de origem foi informado mais de uma vez.',
      });
    }
    seen.add(item.sourceEnrollmentId);

    if (!sourcesById.has(item.sourceEnrollmentId)) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: 'SOURCE_NOT_FOUND',
        message: 'Vínculo de origem não encontrado no contexto da conta.',
      });
    }

    if (item.decision === 'RENEW' && !runtimeItem.target) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: 'TARGET_REQUIRED',
        message: 'A decisão de renovar exige destino futuro.',
      });
    }

    if (item.decision !== 'RENEW' && runtimeItem.target !== null) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: 'TARGET_MUST_BE_NULL',
        message: 'Decisões sem renovação não podem carregar destino residual.',
      });
    }
  }

  const renewItems = input.items.filter((item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW');
  const sourceDates = input.items
    .map((item) => sourcesById.get(item.sourceEnrollmentId)?.currentContractEndsAt)
    .filter((date): date is Date => Boolean(date));
  const latestCurrentContractEnd =
    sourceDates.length > 0
      ? new Date(Math.max(...sourceDates.map((date) => date.getTime())))
      : new Date();
  const effectiveAt = calculateRenewalEffectiveAt({
    currentContractEndsAt: latestCurrentContractEnd,
    targetPeriodStartsAt: input.targetPeriodStartsAt,
    requestedEffectiveAt: input.requestedEffectiveAt,
  });

  if (input.requestedEffectiveAt && toDateOnly(input.requestedEffectiveAt) < effectiveAt) {
    warnings.push('A data efetiva foi ajustada para não sobrepor o vínculo atual.');
  }

  if (renewItems.length === 0 && input.items.length > 0) {
    warnings.push('Nenhum vínculo será renovado; apenas as decisões serão registradas.');
  }

  const monthlyTotal = roundMoney(
    renewItems.reduce((sum, item) => sum + (sourcesById.get(item.sourceEnrollmentId)?.monthlyAmount ?? 0), 0),
  );
  const enrollmentFeeUnit = roundMoney(input.enrollmentFeeAmount ?? 0);
  const enrollmentFeeTotal = roundMoney(enrollmentFeeUnit * renewItems.length);

  const targetEnrollments = renewItems.map((item) => ({
    sourceEnrollmentId: item.sourceEnrollmentId,
    targetType: item.target.type,
    targetId: item.target.targetId,
    planId: item.target.planId,
    effectiveAt: isoDate(effectiveAt),
  }));

  const reservations = renewItems.map((item) => ({
    sourceEnrollmentId: item.sourceEnrollmentId,
    status: 'RESERVED' as const,
    effectiveAt: isoDate(effectiveAt),
  }));

  const firstDueDate = input.requestedFirstDueDate ? isoDate(input.requestedFirstDueDate) : null;
  const futureFinancialAgreement =
    renewItems.length > 0
      ? {
          monthlyTotal,
          enrollmentFeeTotal,
          firstDueDate,
        }
      : null;

  const sourceVersion = buildRenewalSourceVersion(
    input.sourceEnrollments.filter((source) => seen.has(source.id)),
  );
  const snapshot = {
    version: 1,
    contaId: input.contaId,
    origin: input.origin,
    campaignId: input.campaignId ?? null,
    targetPeriodId: input.targetPeriodId,
    holderType: input.holderType,
    holderId: input.holderId,
    sourceVersion,
    dependencyVersion: input.dependencyVersion ?? null,
    dependencySnapshot: input.dependencySnapshot ?? null,
    effectiveAt: isoDate(effectiveAt),
    firstDueDate,
    items: input.items.map((item) => ({
      sourceEnrollmentId: item.sourceEnrollmentId,
      decision: item.decision,
      target: item.target,
    })),
    monthlyTotal,
    enrollmentFeeTotal,
  };

  return {
    previewHash: hashSnapshot(snapshot),
    sourceVersion,
    renewCount: renewItems.length,
    pendingCount: input.items.filter((item) => item.decision === 'DECIDE_LATER').length,
    nonRenewalCount: input.items.filter((item) => item.decision === 'DO_NOT_CONTINUE').length,
    targetEnrollments,
    reservations,
    futureFinancialAgreement,
    monthlyTotal,
    enrollmentFeeTotal,
    effectiveAt: isoDate(effectiveAt),
    firstDueDate,
    blockers,
    warnings,
    snapshot,
  };
}

export function canTransitionRenewalProcess(
  from: RenewalProcessStatus,
  to: RenewalProcessStatus,
): boolean {
  const transitions: Record<RenewalProcessStatus, RenewalProcessStatus[]> = {
    DRAFT: ['PREVIEWED', 'CANCELLED'],
    PREVIEWED: ['CONFIRMED', 'PARTIALLY_CONFIRMED', 'CANCELLED', 'REQUIRES_ATTENTION'],
    PARTIALLY_CONFIRMED: ['CONFIRMED', 'CANCELLED', 'REQUIRES_ATTENTION'],
    CONFIRMED: ['WAITING_FOR_START', 'CANCELLED', 'REQUIRES_ATTENTION', 'EFFECTIVE'],
    WAITING_FOR_START: ['EFFECTIVE', 'CANCELLED', 'REQUIRES_ATTENTION'],
    REQUIRES_ATTENTION: ['CONFIRMED', 'WAITING_FOR_START', 'CANCELLED'],
    EFFECTIVE: ['COMPLETED'],
    CANCELLED: [],
    COMPLETED: [],
  };
  return transitions[from].includes(to);
}
