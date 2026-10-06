import { prisma } from '@alusa/database';
import { Prisma, type AsaasResourceOriginType, type AsaasResourceOriginValue } from '@prisma/client';

export type AsaasOriginClassification = {
  contaId: string;
  resourceType: Extract<AsaasResourceOriginType, 'SUBSCRIPTION' | 'PAYMENT' | 'INSTALLMENT'>;
  asaasId: string;
  origin: AsaasResourceOriginValue;
  reason: string;
  actorId: string;
};

type Db = Prisma.TransactionClient;
const CANONICAL_REF_SQL = [
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'alusa:%'",
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'subscription:%'",
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'enrollment-op:%'",
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'installmentPlan:%'",
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'event-map-order:%'",
  "COALESCE(w.payload #>> '{subscription,externalReference}', '') LIKE 'event-entry:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'alusa:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'charge:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'standalone:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'enrollment-op:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'subscription:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'installmentPlan:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'event-map-order:%'",
  "COALESCE(w.payload #>> '{payment,externalReference}', '') LIKE 'event-entry:%'",
].join(' OR ');

type CandidateRow = {
  subscriptionId: string;
  relatedPayments: number;
  samplePaymentIds: string[];
  hasCanonicalReference: boolean;
  hasSubscriptionRecord: boolean;
  hasStandaloneSubscription: boolean;
  hasBillingAgreement: boolean;
  hasEnrollment: boolean;
  hasEnrollmentOperation: boolean;
  hasFutureRenewalAgreement: boolean;
  priorOrigin: AsaasResourceOriginValue | null;
  hasAlusaPaymentOrigin: boolean;
};

function candidateState(row: CandidateRow) {
  const hasLocalSubscription = row.hasSubscriptionRecord || row.hasStandaloneSubscription || row.hasBillingAgreement || row.hasEnrollment || row.hasEnrollmentOperation || row.hasFutureRenewalAgreement;
  if (hasLocalSubscription) return { eligible: false, conflict: 'LOCAL_SUBSCRIPTION_EXISTS' as const };
  if (row.priorOrigin === 'EXTERNAL') return { eligible: false, conflict: 'ALREADY_EXTERNAL' as const };
  if (row.priorOrigin) return { eligible: false, conflict: 'SUBSCRIPTION_ALREADY_CLASSIFIED' as const };
  if (row.hasCanonicalReference) return { eligible: false, conflict: 'CANONICAL_ALUSA_REFERENCE' as const };
  if (row.hasAlusaPaymentOrigin) return { eligible: false, conflict: 'RELATED_PAYMENT_CLASSIFIED_ALUSA' as const };
  return { eligible: true, conflict: null };
}

type PaymentCandidateRow = {
  paymentId: string;
  eventCount: number;
  sampleExternalReferences: string[];
  hasCanonicalReference: boolean;
  hasCharge: boolean;
  hasCobranca: boolean;
  hasPagamento: boolean;
  hasEventMapOrder: boolean;
  hasEventTicketSale: boolean;
  hasEventFinancialEntry: boolean;
  hasEventParticipant: boolean;
  hasEventBillingGroup: boolean;
  priorOrigin: AsaasResourceOriginValue | null;
};

function paymentCandidateState(row: PaymentCandidateRow) {
  if (row.hasCharge || row.hasCobranca || row.hasPagamento || row.hasEventMapOrder || row.hasEventTicketSale || row.hasEventFinancialEntry || row.hasEventParticipant || row.hasEventBillingGroup) return { eligible: false, conflict: 'LOCAL_PAYMENT_EXISTS' as const };
  if (row.priorOrigin === 'EXTERNAL') return { eligible: false, conflict: 'ALREADY_EXTERNAL' as const };
  if (row.priorOrigin) return { eligible: false, conflict: 'PAYMENT_ALREADY_CLASSIFIED' as const };
  if (row.hasCanonicalReference) return { eligible: false, conflict: 'CANONICAL_ALUSA_REFERENCE' as const };
  return { eligible: true, conflict: null };
}

async function queryPaymentCandidatePage(db: Db, input: { contaId: string; cursor?: string | null; paymentId?: string | null; take: number }) {
  return db.$queryRaw<PaymentCandidateRow[]>`
    WITH observed_events AS (
      SELECT w."contaId", w."asaasPaymentId", w.payload FROM "WebhookAsaas" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" IS NOT NULL AND w."asaasSubscriptionId" IS NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') IS NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,subscription}'), '') IS NULL
      UNION ALL
      SELECT w."contaId", w."asaasPaymentId", w.payload FROM "WebhookAsaasArchive" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" IS NOT NULL AND w."asaasSubscriptionId" IS NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') IS NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,subscription}'), '') IS NULL
    ), grouped AS (
      SELECT w."asaasPaymentId" AS "paymentId", COUNT(*)::int AS "eventCount",
        BOOL_OR(${Prisma.raw(CANONICAL_REF_SQL)}) AS "hasCanonicalReference"
      FROM observed_events w
      WHERE (${input.paymentId ?? null}::text IS NULL OR w."asaasPaymentId" = ${input.paymentId ?? null})
        AND (${input.cursor ?? null}::text IS NULL OR w."asaasPaymentId" > ${input.cursor ?? null})
      GROUP BY w."asaasPaymentId"
    ), flags AS (
      SELECT g.*,
        EXISTS (SELECT 1 FROM "Charge" c WHERE c."contaId" = ${input.contaId} AND c."asaasPaymentId" = g."paymentId") AS "hasCharge",
        EXISTS (SELECT 1 FROM "Cobranca" c WHERE c."contaId" = ${input.contaId} AND (c."asaasPaymentId" = g."paymentId" OR c."asaasId" = g."paymentId")) AS "hasCobranca",
        EXISTS (SELECT 1 FROM "Pagamento" p WHERE p."contaId" = ${input.contaId} AND p."asaasPaymentId" = g."paymentId") AS "hasPagamento",
        EXISTS (SELECT 1 FROM "EventMapOrder" e WHERE e."contaId" = ${input.contaId} AND e."asaasPaymentId" = g."paymentId") AS "hasEventMapOrder",
        EXISTS (SELECT 1 FROM "EventTicketSale" e WHERE e."contaId" = ${input.contaId} AND e."asaasPaymentId" = g."paymentId") AS "hasEventTicketSale",
        EXISTS (SELECT 1 FROM "EventFinancialEntry" e WHERE e."contaId" = ${input.contaId} AND e."asaasPaymentId" = g."paymentId") AS "hasEventFinancialEntry",
        EXISTS (SELECT 1 FROM "EventParticipant" e WHERE e."contaId" = ${input.contaId} AND e."asaasPaymentId" = g."paymentId") AS "hasEventParticipant",
        EXISTS (SELECT 1 FROM "EventBillingGroup" e WHERE e."contaId" = ${input.contaId} AND e."asaasPaymentId" = g."paymentId") AS "hasEventBillingGroup",
        (SELECT o."origin" FROM "AsaasResourceOrigin" o WHERE o."contaId" = ${input.contaId}
          AND o."resourceType" = 'PAYMENT' AND o."asaasId" = g."paymentId") AS "priorOrigin"
      FROM grouped g
    )
    SELECT flags.*,
      ARRAY(
        SELECT DISTINCT NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '')
        FROM observed_events event
        WHERE event."contaId" = ${input.contaId} AND event."asaasPaymentId" = flags."paymentId"
          AND NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '') IS NOT NULL
        ORDER BY NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '') ASC
        LIMIT 10
      ) AS "sampleExternalReferences"
    FROM flags
    ORDER BY "paymentId" ASC
    LIMIT ${input.take}
  `;
}

type InstallmentCandidateRow = {
  installmentId: string;
  paymentCount: number;
  samplePaymentIds: string[];
  sampleExternalReferences: string[];
  hasCanonicalReference: boolean;
  hasAcademicInstallment: boolean;
  hasStandaloneInstallment: boolean;
  hasEventParticipant: boolean;
  hasEventBillingGroup: boolean;
  hasAlusaPaymentOrigin: boolean;
  priorOrigin: AsaasResourceOriginValue | null;
};

function installmentCandidateState(row: InstallmentCandidateRow) {
  if (row.hasAcademicInstallment || row.hasStandaloneInstallment || row.hasEventParticipant || row.hasEventBillingGroup) {
    return { eligible: false, conflict: 'LOCAL_INSTALLMENT_EXISTS' as const };
  }
  if (row.hasAlusaPaymentOrigin) return { eligible: false, conflict: 'RELATED_PAYMENT_CLASSIFIED_ALUSA' as const };
  if (row.priorOrigin === 'EXTERNAL') return { eligible: false, conflict: 'ALREADY_EXTERNAL' as const };
  if (row.priorOrigin) return { eligible: false, conflict: 'INSTALLMENT_ALREADY_CLASSIFIED' as const };
  if (row.hasCanonicalReference) return { eligible: false, conflict: 'CANONICAL_ALUSA_REFERENCE' as const };
  return { eligible: true, conflict: null };
}

async function queryInstallmentCandidatePage(db: Db, input: { contaId: string; cursor?: string | null; installmentId?: string | null; take: number }) {
  return db.$queryRaw<InstallmentCandidateRow[]>`
    WITH observed_events AS (
      SELECT w."contaId", w."asaasPaymentId", w.payload,
        NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') AS "installmentId"
      FROM "WebhookAsaas" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" IS NOT NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') IS NOT NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,subscription}'), '') IS NULL
      UNION ALL
      SELECT w."contaId", w."asaasPaymentId", w.payload,
        NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') AS "installmentId"
      FROM "WebhookAsaasArchive" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" IS NOT NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,installment}'), '') IS NOT NULL
        AND NULLIF(BTRIM(w.payload #>> '{payment,subscription}'), '') IS NULL
    ), grouped AS (
      SELECT w."installmentId", COUNT(DISTINCT w."asaasPaymentId")::int AS "paymentCount",
        BOOL_OR(${Prisma.raw(CANONICAL_REF_SQL)}) AS "hasCanonicalReference"
      FROM observed_events w
      WHERE (${input.installmentId ?? null}::text IS NULL OR w."installmentId" = ${input.installmentId ?? null})
        AND (${input.cursor ?? null}::text IS NULL OR w."installmentId" > ${input.cursor ?? null})
      GROUP BY w."installmentId"
    ), flags AS (
      SELECT g.*,
        EXISTS (SELECT 1 FROM "InstallmentPlan" p WHERE p."contaId" = ${input.contaId} AND p."asaasInstallmentId" = g."installmentId") AS "hasAcademicInstallment",
        EXISTS (SELECT 1 FROM "StandaloneInstallmentPlan" p WHERE p."contaId" = ${input.contaId} AND p."asaasInstallmentId" = g."installmentId") AS "hasStandaloneInstallment",
        EXISTS (SELECT 1 FROM "EventParticipant" e WHERE e."contaId" = ${input.contaId} AND e."asaasInstallmentId" = g."installmentId") AS "hasEventParticipant",
        EXISTS (SELECT 1 FROM "EventBillingGroup" e WHERE e."contaId" = ${input.contaId} AND e."asaasInstallmentId" = g."installmentId") AS "hasEventBillingGroup",
        EXISTS (
          SELECT 1 FROM observed_events pe
          JOIN "AsaasResourceOrigin" po ON po."contaId" = ${input.contaId}
            AND po."resourceType" = 'PAYMENT' AND po."asaasId" = pe."asaasPaymentId"
          WHERE pe."contaId" = ${input.contaId} AND pe."installmentId" = g."installmentId" AND po."origin" = 'ALUSA'
        ) AS "hasAlusaPaymentOrigin",
        (SELECT o."origin" FROM "AsaasResourceOrigin" o WHERE o."contaId" = ${input.contaId}
          AND o."resourceType" = 'INSTALLMENT' AND o."asaasId" = g."installmentId") AS "priorOrigin"
      FROM grouped g
    )
    SELECT flags.*,
      ARRAY(
        SELECT DISTINCT event."asaasPaymentId" FROM observed_events event
        WHERE event."contaId" = ${input.contaId} AND event."installmentId" = flags."installmentId"
          AND event."asaasPaymentId" IS NOT NULL
        ORDER BY event."asaasPaymentId" ASC LIMIT 10
      ) AS "samplePaymentIds",
      ARRAY(
        SELECT DISTINCT NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '') FROM observed_events event
        WHERE event."contaId" = ${input.contaId} AND event."installmentId" = flags."installmentId"
          AND NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '') IS NOT NULL
        ORDER BY NULLIF(BTRIM(event.payload #>> '{payment,externalReference}'), '') ASC LIMIT 10
      ) AS "sampleExternalReferences"
    FROM flags
    ORDER BY "installmentId" ASC
    LIMIT ${input.take}
  `;
}

async function queryCandidatePage(db: Db, input: { contaId: string; cursor?: string | null; subscriptionId?: string | null; take: number }) {
  return db.$queryRaw<CandidateRow[]>`
    WITH observed_events AS (
      SELECT w."contaId", w."asaasSubscriptionId", w."asaasPaymentId", w.payload FROM "WebhookAsaas" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasSubscriptionId" IS NOT NULL
      UNION ALL
      SELECT w."contaId", w."asaasSubscriptionId", w."asaasPaymentId", w.payload FROM "WebhookAsaasArchive" w
      WHERE w."contaId" = ${input.contaId} AND w."asaasSubscriptionId" IS NOT NULL
    ), grouped AS (
      SELECT w."asaasSubscriptionId" AS "subscriptionId",
             COUNT(DISTINCT w."asaasPaymentId")::int AS "relatedPayments",
             BOOL_OR(${Prisma.raw(CANONICAL_REF_SQL)}) AS "hasCanonicalReference"
      FROM observed_events w
      WHERE w."contaId" = ${input.contaId}
        AND (${input.subscriptionId ?? null}::text IS NULL OR w."asaasSubscriptionId" = ${input.subscriptionId ?? null})
        AND (${input.cursor ?? null}::text IS NULL OR w."asaasSubscriptionId" > ${input.cursor ?? null})
      GROUP BY w."asaasSubscriptionId"
    ), flags AS (
      SELECT g.*,
        EXISTS (SELECT 1 FROM "Subscription" s WHERE s."contaId" = ${input.contaId} AND s."asaasSubscriptionId" = g."subscriptionId") AS "hasSubscriptionRecord",
        EXISTS (SELECT 1 FROM "StandaloneSubscription" s WHERE s."contaId" = ${input.contaId} AND s."asaasSubscriptionId" = g."subscriptionId") AS "hasStandaloneSubscription",
        EXISTS (SELECT 1 FROM "BillingAgreement" b WHERE b."contaId" = ${input.contaId} AND b."asaasSubscriptionId" = g."subscriptionId") AS "hasBillingAgreement",
        EXISTS (SELECT 1 FROM "Matricula" m WHERE m."contaId" = ${input.contaId} AND m."asaasSubscriptionId" = g."subscriptionId") AS "hasEnrollment",
        EXISTS (SELECT 1 FROM "EnrollmentCreationOperation" e WHERE e."contaId" = ${input.contaId} AND e."asaasSubscriptionId" = g."subscriptionId") AS "hasEnrollmentOperation",
        EXISTS (SELECT 1 FROM "AcordoFinanceiroFuturo" f WHERE f."contaId" = ${input.contaId} AND f."asaasSubscriptionId" = g."subscriptionId") AS "hasFutureRenewalAgreement",
        (SELECT o."origin" FROM "AsaasResourceOrigin" o WHERE o."contaId" = ${input.contaId}
          AND o."resourceType" = 'SUBSCRIPTION' AND o."asaasId" = g."subscriptionId") AS "priorOrigin",
        EXISTS (
          SELECT 1 FROM observed_events pw
          JOIN "AsaasResourceOrigin" po ON po."contaId" = ${input.contaId}
            AND po."resourceType" = 'PAYMENT' AND po."asaasId" = pw."asaasPaymentId"
          WHERE pw."contaId" = ${input.contaId} AND pw."asaasSubscriptionId" = g."subscriptionId"
            AND po."origin" = 'ALUSA'
        ) AS "hasAlusaPaymentOrigin"
      FROM grouped g
    )
    SELECT flags.*,
      ARRAY(
        SELECT DISTINCT pw."asaasPaymentId"
        FROM observed_events pw
        WHERE pw."contaId" = ${input.contaId}
          AND pw."asaasSubscriptionId" = flags."subscriptionId"
          AND pw."asaasPaymentId" IS NOT NULL
        ORDER BY pw."asaasPaymentId" ASC
        LIMIT 10
      ) AS "samplePaymentIds"
    FROM flags
    ORDER BY "subscriptionId" ASC
    LIMIT ${input.take}
  `;
}

async function getCandidate(db: Db, contaId: string, subscriptionId: string) {
  const rows = await queryCandidatePage(db, { contaId, subscriptionId, take: 1 });
  return rows[0] ?? null;
}

async function getPaymentCandidate(db: Db, contaId: string, paymentId: string) {
  const rows = await queryPaymentCandidatePage(db, { contaId, paymentId, take: 1 });
  return rows[0] ?? null;
}

async function getInstallmentCandidate(db: Db, contaId: string, installmentId: string) {
  const rows = await queryInstallmentCandidatePage(db, { contaId, installmentId, take: 1 });
  return rows[0] ?? null;
}

export type ExternalSubscriptionPreview = {
  subscriptionId: string;
  relatedPaymentCount: number;
  samplePaymentIds: string[];
  evidence: string[];
  eligible: boolean;
  conflict: string | null;
};

export async function previewExternalSubscriptionCandidates(input: {
  contaId: string;
  pageSize?: number;
  cursor?: string | null;
  db?: Db;
}) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const db = input.db ?? (prisma as unknown as Db);
  const [rows, totalRows] = await Promise.all([
    queryCandidatePage(db, { contaId: input.contaId, cursor: input.cursor, take: pageSize + 1 }),
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM (
        SELECT observed."asaasSubscriptionId" FROM (
          SELECT "asaasSubscriptionId" FROM "WebhookAsaas" WHERE "contaId" = ${input.contaId} AND "asaasSubscriptionId" IS NOT NULL
          UNION
          SELECT "asaasSubscriptionId" FROM "WebhookAsaasArchive" WHERE "contaId" = ${input.contaId} AND "asaasSubscriptionId" IS NOT NULL
        ) observed GROUP BY observed."asaasSubscriptionId"
      ) grouped
    `,
  ]);
  const hasNextPage = rows.length > pageSize;
  const pageRows = hasNextPage ? rows.slice(0, pageSize) : rows;
  return {
    items: pageRows.map((row): ExternalSubscriptionPreview => ({
      subscriptionId: row.subscriptionId,
      relatedPaymentCount: row.relatedPayments,
      samplePaymentIds: row.samplePaymentIds ?? [],
      evidence: [
        'EVENTS_STORED_FOR_TENANT',
        ...(row.hasSubscriptionRecord ? ['LOCAL_SUBSCRIPTION_RECORD'] : []),
        ...(row.hasStandaloneSubscription ? ['LOCAL_STANDALONE_SUBSCRIPTION'] : []),
        ...(row.hasBillingAgreement ? ['LOCAL_BILLING_AGREEMENT'] : []),
        ...(row.hasEnrollment ? ['LOCAL_ENROLLMENT'] : []),
        ...(row.hasEnrollmentOperation ? ['LOCAL_ENROLLMENT_CREATION_OPERATION'] : []),
        ...(row.hasFutureRenewalAgreement ? ['LOCAL_FUTURE_RENEWAL_AGREEMENT'] : []),
        ...(row.hasCanonicalReference ? ['CANONICAL_ALUSA_REFERENCE_IN_EVENT'] : ['NO_CANONICAL_ALUSA_REFERENCE_IN_STORED_EVENTS']),
        ...(row.hasAlusaPaymentOrigin ? ['RELATED_PAYMENT_CLASSIFIED_ALUSA'] : ['NO_RELATED_PAYMENT_CLASSIFIED_ALUSA']),
      ],
      ...candidateState(row),
    })),
    total: Number(totalRows[0]?.total ?? 0n),
    pageSize,
    nextCursor: hasNextPage ? pageRows.at(-1)?.subscriptionId ?? null : null,
  };
}

export type ExternalPaymentPreview = {
  paymentId: string;
  eventCount: number;
  sampleExternalReferences: string[];
  evidence: string[];
  eligible: boolean;
  conflict: string | null;
};

export async function previewExternalPaymentCandidates(input: {
  contaId: string;
  pageSize?: number;
  cursor?: string | null;
  db?: Db;
}) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const db = input.db ?? (prisma as unknown as Db);
  const [rows, totalRows] = await Promise.all([
    queryPaymentCandidatePage(db, { contaId: input.contaId, cursor: input.cursor, take: pageSize + 1 }),
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM (
        SELECT observed."asaasPaymentId" FROM (
          SELECT "asaasPaymentId" FROM "WebhookAsaas" WHERE "contaId" = ${input.contaId} AND "asaasPaymentId" IS NOT NULL AND "asaasSubscriptionId" IS NULL AND NULLIF(BTRIM(payload #>> '{payment,installment}'), '') IS NULL AND NULLIF(BTRIM(payload #>> '{payment,subscription}'), '') IS NULL
          UNION
          SELECT "asaasPaymentId" FROM "WebhookAsaasArchive" WHERE "contaId" = ${input.contaId} AND "asaasPaymentId" IS NOT NULL AND "asaasSubscriptionId" IS NULL AND NULLIF(BTRIM(payload #>> '{payment,installment}'), '') IS NULL AND NULLIF(BTRIM(payload #>> '{payment,subscription}'), '') IS NULL
        ) observed GROUP BY observed."asaasPaymentId"
      ) grouped
    `,
  ]);
  const hasNextPage = rows.length > pageSize;
  const pageRows = hasNextPage ? rows.slice(0, pageSize) : rows;
  return {
    items: pageRows.map((row): ExternalPaymentPreview => ({
      paymentId: row.paymentId,
      eventCount: row.eventCount,
      sampleExternalReferences: row.sampleExternalReferences ?? [],
      evidence: [
        'PAYMENT_EVENT_WITHOUT_SUBSCRIPTION_IN_TENANT_HISTORY',
        ...(row.hasCharge ? ['LOCAL_CHARGE_LINK'] : []),
        ...(row.hasCobranca ? ['LOCAL_COBRANCA_LINK'] : []),
        ...(row.hasPagamento ? ['LOCAL_PAGAMENTO_LINK'] : []),
        ...(row.hasEventMapOrder ? ['LOCAL_EVENT_MAP_ORDER_LINK'] : []),
        ...(row.hasEventTicketSale ? ['LOCAL_EVENT_TICKET_SALE_LINK'] : []),
        ...(row.hasEventFinancialEntry ? ['LOCAL_EVENT_FINANCIAL_ENTRY_LINK'] : []),
        ...(row.hasEventParticipant ? ['LOCAL_EVENT_PARTICIPANT_LINK'] : []),
        ...(row.hasEventBillingGroup ? ['LOCAL_EVENT_BILLING_GROUP_LINK'] : []),
        ...(row.hasCanonicalReference ? ['CANONICAL_ALUSA_REFERENCE_IN_EVENT'] : ['NO_CANONICAL_ALUSA_REFERENCE_IN_STORED_EVENTS']),
        ...(row.priorOrigin ? [`PREVIOUSLY_CLASSIFIED_${row.priorOrigin}`] : ['NO_PREVIOUS_ORIGIN_CLASSIFICATION']),
      ],
      ...paymentCandidateState(row),
    })),
    total: Number(totalRows[0]?.total ?? 0n),
    pageSize,
    nextCursor: hasNextPage ? pageRows.at(-1)?.paymentId ?? null : null,
  };
}

export type ExternalInstallmentPreview = {
  installmentId: string;
  paymentCount: number;
  samplePaymentIds: string[];
  sampleExternalReferences: string[];
  evidence: string[];
  eligible: boolean;
  conflict: string | null;
};

export async function previewExternalInstallmentCandidates(input: {
  contaId: string;
  pageSize?: number;
  cursor?: string | null;
  db?: Db;
}) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const db = input.db ?? (prisma as unknown as Db);
  const [rows, totalRows] = await Promise.all([
    queryInstallmentCandidatePage(db, { contaId: input.contaId, cursor: input.cursor, take: pageSize + 1 }),
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM (
        SELECT observed."installmentId" FROM (
          SELECT NULLIF(BTRIM(payload #>> '{payment,installment}'), '') AS "installmentId" FROM "WebhookAsaas"
          WHERE "contaId" = ${input.contaId} AND "asaasPaymentId" IS NOT NULL
            AND NULLIF(BTRIM(payload #>> '{payment,subscription}'), '') IS NULL
          UNION
          SELECT NULLIF(BTRIM(payload #>> '{payment,installment}'), '') AS "installmentId" FROM "WebhookAsaasArchive"
          WHERE "contaId" = ${input.contaId} AND "asaasPaymentId" IS NOT NULL
            AND NULLIF(BTRIM(payload #>> '{payment,subscription}'), '') IS NULL
        ) observed WHERE observed."installmentId" IS NOT NULL GROUP BY observed."installmentId"
      ) grouped
    `,
  ]);
  const hasNextPage = rows.length > pageSize;
  const pageRows = hasNextPage ? rows.slice(0, pageSize) : rows;
  return {
    items: pageRows.map((row): ExternalInstallmentPreview => ({
      installmentId: row.installmentId,
      paymentCount: row.paymentCount,
      samplePaymentIds: row.samplePaymentIds ?? [],
      sampleExternalReferences: row.sampleExternalReferences ?? [],
      evidence: [
        'PAYMENT_EVENTS_WITH_PROVIDER_INSTALLMENT_ID_IN_TENANT_HISTORY',
        ...(row.hasAcademicInstallment ? ['LOCAL_ACADEMIC_INSTALLMENT_PLAN'] : []),
        ...(row.hasStandaloneInstallment ? ['LOCAL_STANDALONE_INSTALLMENT_PLAN'] : []),
        ...(row.hasEventParticipant ? ['LOCAL_EVENT_PARTICIPANT_INSTALLMENT_LINK'] : []),
        ...(row.hasEventBillingGroup ? ['LOCAL_EVENT_BILLING_GROUP_INSTALLMENT_LINK'] : []),
        ...(row.hasAlusaPaymentOrigin ? ['RELATED_PAYMENT_CLASSIFIED_ALUSA'] : ['NO_RELATED_PAYMENT_CLASSIFIED_ALUSA']),
        ...(row.hasCanonicalReference ? ['CANONICAL_ALUSA_REFERENCE_IN_EVENT'] : ['NO_CANONICAL_ALUSA_REFERENCE_IN_STORED_EVENTS']),
        ...(row.priorOrigin ? [`PREVIOUSLY_CLASSIFIED_${row.priorOrigin}`] : ['NO_PREVIOUS_ORIGIN_CLASSIFICATION']),
      ],
      ...installmentCandidateState(row),
    })),
    total: Number(totalRows[0]?.total ?? 0n),
    pageSize,
    nextCursor: hasNextPage ? pageRows.at(-1)?.installmentId ?? null : null,
  };
}

async function classifyInTransaction(db: Db, input: AsaasOriginClassification) {
  const reason = input.reason.trim();
  if (reason.length < 8) throw new Error('Informe uma justificativa com pelo menos 8 caracteres.');
  if (!input.asaasId.trim() || !input.actorId.trim()) throw new Error('Identificador e ator são obrigatórios.');

  const localResource = input.resourceType === 'SUBSCRIPTION'
    ? await db.subscription.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
      ?? await db.standaloneSubscription.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
      ?? await db.billingAgreement.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
      ?? await db.matricula.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
      ?? await db.enrollmentCreationOperation.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
      ?? await db.acordoFinanceiroFuturo.findFirst({ where: { contaId: input.contaId, asaasSubscriptionId: input.asaasId }, select: { id: true } })
    : input.resourceType === 'INSTALLMENT'
      ? await db.installmentPlan.findFirst({ where: { contaId: input.contaId, asaasInstallmentId: input.asaasId }, select: { id: true } })
        ?? await db.standaloneInstallmentPlan.findFirst({ where: { contaId: input.contaId, asaasInstallmentId: input.asaasId }, select: { id: true } })
        ?? await db.eventParticipant.findFirst({ where: { contaId: input.contaId, asaasInstallmentId: input.asaasId }, select: { id: true } })
        ?? await db.eventBillingGroup.findFirst({ where: { contaId: input.contaId, asaasInstallmentId: input.asaasId }, select: { id: true } })
      : await db.charge.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.cobranca.findFirst({ where: { contaId: input.contaId, OR: [{ asaasPaymentId: input.asaasId }, { asaasId: input.asaasId }], matricula: { contaId: input.contaId, aluno: { contaId: input.contaId } } }, select: { id: true } })
      ?? await db.pagamento.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.eventMapOrder.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.eventTicketSale.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.eventFinancialEntry.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.eventParticipant.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } })
      ?? await db.eventBillingGroup.findFirst({ where: { contaId: input.contaId, asaasPaymentId: input.asaasId }, select: { id: true } });
  const prior = await db.asaasResourceOrigin.findUnique({ where: {
    uq_asaas_resource_origin_tenant_resource: { contaId: input.contaId, resourceType: input.resourceType, asaasId: input.asaasId.trim() },
  } });

  if (input.origin === 'ALUSA' && !localResource) throw new Error('A origem ALUSA exige vínculo local confiável nesta conta.');
  if (input.origin === 'EXTERNAL') {
    if (localResource) throw new Error('O recurso já possui vínculo local nesta conta.');
    if (input.resourceType === 'SUBSCRIPTION') {
      const candidate = await getCandidate(db, input.contaId, input.asaasId);
      if (!candidate) throw new Error('Assinatura não encontrada na prévia desta conta.');
      const state = candidateState({ ...candidate, priorOrigin: prior?.origin === 'EXTERNAL' ? null : candidate.priorOrigin });
      if (!state.eligible) throw new Error(state.conflict ?? 'Assinatura não elegível para classificação externa.');
    } else if (input.resourceType === 'PAYMENT') {
      const candidate = await getPaymentCandidate(db, input.contaId, input.asaasId);
      if (!candidate) throw new Error('Pagamento avulso não encontrado na prévia desta conta.');
      const state = paymentCandidateState({ ...candidate, priorOrigin: prior?.origin === 'EXTERNAL' ? null : candidate.priorOrigin });
      if (!state.eligible) throw new Error(state.conflict ?? 'Pagamento não elegível para classificação externa.');
    } else {
      const candidate = await getInstallmentCandidate(db, input.contaId, input.asaasId);
      if (!candidate) throw new Error('Parcelamento não encontrado na prévia desta conta.');
      const state = installmentCandidateState({ ...candidate, priorOrigin: prior?.origin === 'EXTERNAL' ? null : candidate.priorOrigin });
      if (!state.eligible) throw new Error(state.conflict ?? 'Parcelamento não elegível para classificação externa.');
    }
  }

  if (prior?.origin === input.origin && prior.reason === reason) return { record: prior, changed: false, reclassified: false };
  if (prior && prior.origin !== input.origin && input.origin === 'EXTERNAL' && prior.origin === 'ALUSA') {
    throw new Error('Reclassificação para EXTERNAL não é permitida enquanto houver decisão ALUSA.');
  }

  const now = new Date();
  const history: Prisma.InputJsonArray = [
    ...(Array.isArray(prior?.history) ? prior.history as Prisma.JsonArray : []),
    ...(prior ? [{ origin: prior.origin, reason: prior.reason, actorId: prior.actorId, classifiedAt: prior.classifiedAt.toISOString() }] : []),
  ];
  const record = await db.asaasResourceOrigin.upsert({
    where: { uq_asaas_resource_origin_tenant_resource: {
      contaId: input.contaId, resourceType: input.resourceType, asaasId: input.asaasId.trim(),
    } },
    create: { ...input, asaasId: input.asaasId.trim(), reason, classifiedAt: now },
    update: { origin: input.origin, reason, actorId: input.actorId, classifiedAt: now, history },
  });
  const reclassified = Boolean(prior && prior.origin !== input.origin);
  await db.auditLog.create({ data: {
    contaId: input.contaId,
    actorType: 'ADMIN',
    actorId: input.actorId,
    action: reclassified ? 'finance.asaas_resource_origin.reclassified' : 'finance.asaas_resource_origin.classified',
    entityType: 'AsaasResourceOrigin',
    entityId: record.id,
    metadata: { resourceType: input.resourceType, asaasId: input.asaasId, origin: input.origin, reason,
      previousOrigin: prior?.origin ?? null },
  } });
  return { record, changed: true, reclassified };
}

export async function classifyAsaasResourceOrigin(input: AsaasOriginClassification & { db?: Db }) {
  if (input.db) return classifyInTransaction(input.db, input);
  return prisma.$transaction((tx) => classifyInTransaction(tx, input), { isolationLevel: 'Serializable' });
}

export async function classifyPreviewedExternalSubscription(input: {
  contaId: string; subscriptionId: string; actorId: string; reason: string; db?: Db;
}) {
  return classifyAsaasResourceOrigin({
    contaId: input.contaId, resourceType: 'SUBSCRIPTION', asaasId: input.subscriptionId,
    origin: 'EXTERNAL', reason: input.reason, actorId: input.actorId, db: input.db,
  });
}

export async function classifyPreviewedExternalPayment(input: {
  contaId: string; paymentId: string; actorId: string; reason: string; db?: Db;
}) {
  return classifyAsaasResourceOrigin({
    contaId: input.contaId, resourceType: 'PAYMENT', asaasId: input.paymentId,
    origin: 'EXTERNAL', reason: input.reason, actorId: input.actorId, db: input.db,
  });
}

export async function classifyPreviewedExternalInstallment(input: {
  contaId: string; installmentId: string; actorId: string; reason: string; db?: Db;
}) {
  return classifyAsaasResourceOrigin({
    contaId: input.contaId, resourceType: 'INSTALLMENT', asaasId: input.installmentId,
    origin: 'EXTERNAL', reason: input.reason, actorId: input.actorId, db: input.db,
  });
}
