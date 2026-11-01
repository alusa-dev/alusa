// Este módulo também é carregado por jobs/tsx fora do bundler do Next.
// O sufixo explícito mantém a resolução ESM válida nesses dois ambientes.
import { NextResponse } from 'next/server.js';
import { parseStripeEnvironment, type StripeEnvironment } from '@alusa/stripe';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';

const PLATFORM_BILLING_MANAGE_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

export function resolvePlatformBillingEnvironment(): StripeEnvironment {
  return parseStripeEnvironment(process.env.STRIPE_ENVIRONMENT ?? 'TEST');
}

export async function resolvePlatformBillingActor(params: {
  tx: TenantTransactionClient;
  contaId: string;
  userId: string;
}) {
  const [user, membership, conta] = await Promise.all([
    params.tx.usuario.findFirst({
      where: {
        id: params.userId,
        contaId: params.contaId,
      },
      select: { id: true, nome: true, email: true, role: true, status: true },
    }),
    params.tx.usuarioConta.findUnique({
      where: {
        usuarioId_contaId: {
          usuarioId: params.userId,
          contaId: params.contaId,
        },
      },
      select: { role: true, status: true },
    }),
    params.tx.conta.findUnique({
      where: { id: params.contaId },
      select: { id: true, nome: true, status: true, deletedAt: true },
    }),
  ]);

  const role = (membership?.role ?? '').toString().toUpperCase();
  const activeAuthorizationContext =
    user?.status === 'ATIVO' &&
    membership?.status === 'ATIVO' &&
    conta?.status === 'ATIVO' &&
    !conta.deletedAt;
  return {
    user,
    conta,
    role,
    canManagePlatformBilling: activeAuthorizationContext && PLATFORM_BILLING_MANAGE_ROLES.has(role),
  };
}

export async function countActivePlatformBillingStudents(params: {
  tx: TenantTransactionClient;
  contaId: string;
  asOf?: Date;
}): Promise<number> {
  const asOf = params.asOf ?? new Date();
  const historical = params.asOf !== undefined;
  const account = await params.tx.conta.findUnique({
    where: { id: params.contaId },
    select: { timezone: true },
  });
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: account?.timezone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(asOf).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
  const asOfDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  if (historical) {
    // Source triggers take this same tenant lock before recording each change.
    // Holding it through snapshot creation serializes a close against in-flight
    // eligibility mutations without pretending mutation time is commit time.
    await params.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-billing-eligibility:' || ${params.contaId}, 0))`;
    const temporalCoverage = await params.tx.platformBillingEligibilityCoverage.findUnique({
      where: { contaId: params.contaId },
      select: { startedAt: true },
    });
    if (temporalCoverage && temporalCoverage.startedAt <= asOf) {
      const splitTransaction = await params.tx.$queryRaw<Array<{ transactionId: string }>>`
        SELECT "transactionId"
        FROM "PlatformBillingEligibilityHistory"
        WHERE "contaId" = ${params.contaId}
        GROUP BY "transactionId"
        HAVING BOOL_OR("recordedAt" <= ${asOf}) AND BOOL_OR("recordedAt" > ${asOf})
        LIMIT 1
      `;
      if (splitTransaction.length > 0) throw new PlatformBillingHistoricalCountInconclusive();
      const temporalRows = await params.tx.$queryRaw<Array<{ studentCount: bigint }>>`
        WITH latest AS (
          SELECT DISTINCT ON ("entityType", "entityId") "entityType", "entityId", "isDeleted", payload
          FROM "PlatformBillingEligibilityHistory"
          WHERE "contaId" = ${params.contaId} AND "recordedAt" <= ${asOf}
          ORDER BY "entityType", "entityId", "recordedAt" DESC, id DESC
        ),
        students AS (
          SELECT "entityId" AS id, payload FROM latest WHERE "entityType" = 'STUDENT' AND NOT "isDeleted"
        ),
        plans AS (
          SELECT "entityId" AS id, payload FROM latest WHERE "entityType" = 'PLAN' AND NOT "isDeleted"
        ),
        combos AS (
          SELECT "entityId" AS id, payload FROM latest WHERE "entityType" = 'COMBO' AND NOT "isDeleted"
        ),
        enrollments AS (
          SELECT "entityId" AS id, payload FROM latest WHERE "entityType" = 'ENROLLMENT' AND NOT "isDeleted"
        ),
        discounts AS (
          SELECT payload->>'matriculaId' AS "matriculaId",
            SUM(COALESCE(NULLIF(payload->>'valorFinal', '')::numeric, 0)) AS amount
          FROM latest WHERE "entityType" = 'DISCOUNT' AND NOT "isDeleted"
          GROUP BY payload->>'matriculaId'
        ),
        effective AS (
          SELECT e.id, e.payload AS enrollment, s.payload AS student,
            COALESCE(NULLIF(c.payload->>'valor', '')::numeric, NULLIF(p.payload->>'valor', '')::numeric, 0) AS cycle_amount,
            COALESCE(d.amount, 0) AS discount_amount
          FROM enrollments e
          JOIN students s ON s.id = e.payload->>'alunoId'
          LEFT JOIN combos c ON c.id = e.payload->>'comboId'
          LEFT JOIN plans p ON p.id = e.payload->>'planoId'
          LEFT JOIN discounts d ON d."matriculaId" = e.id
        )
        SELECT COUNT(DISTINCT enrollment->>'alunoId')::bigint AS "studentCount"
        FROM effective
        WHERE cycle_amount > 0 AND discount_amount < cycle_amount
          AND (enrollment->>'status' = 'ATIVA'
            OR (enrollment->>'status' = 'ENCERRADA' AND (enrollment->>'dataFim' IS NOT NULL OR enrollment->>'dataFimContrato' IS NOT NULL))
            OR (enrollment->>'status' = 'CANCELADA' AND NULLIF(enrollment->>'cancelledAt', '')::timestamptz > ${asOf})
            OR (enrollment->>'status' = 'PAUSADA' AND (COALESCE((enrollment->>'cobrarDurantePausa')::boolean, false)
              OR NULLIF(enrollment->>'dataInicioPausa', '')::timestamptz > ${asOf})))
          AND (student->>'status' = 'ATIVO' OR NULLIF(student->>'dataInativacao', '')::timestamptz > ${asOf})
          AND NULLIF(enrollment->>'dataInicio', '')::timestamptz::date <= ${asOfDate}::date
          AND (NULLIF(enrollment->>'dataFim', '') IS NULL OR NULLIF(enrollment->>'dataFim', '')::timestamptz::date >= ${asOfDate}::date)
          AND (NULLIF(enrollment->>'dataFimContrato', '') IS NULL OR NULLIF(enrollment->>'dataFimContrato', '')::timestamptz::date >= ${asOfDate}::date)
      `;
      return Number(temporalRows[0]?.studentCount ?? 0);
    }
    // Current enrollment rows cannot reveal a physical delete. Historical
    // recovery is accepted only for competencies whose entire start predates
    // a durable audit-coverage marker, and only when no audited deletion took
    // place after the competence closed.
    const monthStartAuditFloor = new Date(
      Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, 1) - 14 * 60 * 60 * 1000,
    );
    const historyCoverage = await params.tx.auditLog.findFirst({
      where: {
        contaId: params.contaId,
        action: 'PLATFORM_BILLING_ELIGIBILITY_HISTORY_TRACKING_STARTED',
        createdAt: { lte: monthStartAuditFloor },
      },
      select: { id: true },
    });
    const deletionAfterClose = await params.tx.auditLog.findFirst({
      where: {
        contaId: params.contaId,
        action: { in: ['MATRICULA_HARD_DELETED', 'FAMILY_ENROLLMENT_DRAFT_ROLLED_BACK'] },
        createdAt: { gt: asOf },
      },
      select: { id: true },
    });
    if (!historyCoverage) throw new PlatformBillingHistoricalCountInconclusive('HISTORICAL_COVERAGE_UNAVAILABLE');
    if (deletionAfterClose) throw new PlatformBillingHistoricalCountInconclusive('HISTORICAL_EVIDENCE_LOST');
  }
  const rows = await params.tx.$queryRaw<Array<{ studentCount: bigint; historyInconclusive: boolean }>>`
    WITH enrollment_state AS (
      SELECT
        m."alunoId",
        m."updatedAt",
        m.status,
        m."cancelledAt",
        m."dataInicioPausa",
        m."cobrarDurantePausa",
        m."dataInicio",
        m."dataFim",
        m."dataFimContrato",
        a.status AS "studentStatus",
        a."dataInativacao",
        a."updatedAt" AS "studentUpdatedAt",
        c."updatedAt" AS "comboUpdatedAt",
        p."updatedAt" AS "planUpdatedAt",
        COALESCE(c.valor, p.valor, 0) AS "cycleAmount",
        COALESCE(SUM(dm."valorFinal"), 0) AS "discountAmount",
        MAX(dm."createdAt") AS "latestDiscountCreatedAt"
      FROM "Matricula" m
      JOIN "Aluno" a ON a.id = m."alunoId" AND a."contaId" = m."contaId"
      LEFT JOIN "Combo" c ON c.id = m."comboId" AND c."contaId" = m."contaId"
      LEFT JOIN "Plano" p ON p.id = m."planoId" AND p."contaId" = m."contaId"
      LEFT JOIN "DescontoMatricula" dm ON dm."matriculaId" = m.id
      WHERE m."contaId" = ${params.contaId}
      GROUP BY m.id, a.status, a."dataInativacao", a."updatedAt", c.valor, c."updatedAt", p.valor, p."updatedAt"
    ),
    effective_enrollment AS (
      SELECT *,
        CASE
          WHEN ${historical} THEN
            (status = 'ATIVA'
              OR (status = 'ENCERRADA' AND ("dataFim" IS NOT NULL OR "dataFimContrato" IS NOT NULL))
              OR (status = 'CANCELADA' AND "cancelledAt" > ${asOf})
              OR (status = 'PAUSADA' AND ("cobrarDurantePausa" OR "dataInicioPausa" > ${asOf})))
            AND ("studentStatus" = 'ATIVO' OR "dataInativacao" > ${asOf})
          ELSE status = 'ATIVA' AND "studentStatus" = 'ATIVO'
        END
        AND "dataInicio"::date <= ${asOfDate}::date
        AND ("dataFim" IS NULL OR "dataFim"::date >= ${asOfDate}::date)
        AND ("dataFimContrato" IS NULL OR "dataFimContrato"::date >= ${asOfDate}::date)
        AS "activeAtDate"
      FROM enrollment_state
    )
    SELECT
      COUNT(DISTINCT "alunoId") FILTER (
        WHERE "activeAtDate" AND "cycleAmount" > 0 AND "discountAmount" < "cycleAmount"
      ) AS "studentCount",
      COALESCE(BOOL_OR("dataInicio"::date <= ${asOfDate}::date AND (
        "updatedAt" > ${asOf}
        OR "studentUpdatedAt" > ${asOf}
        OR "comboUpdatedAt" > ${asOf}
        OR "planUpdatedAt" > ${asOf}
        OR "latestDiscountCreatedAt" > ${asOf}
      )), FALSE) AS "historyInconclusive"
    FROM effective_enrollment
  `;
  const result = rows[0];
  if (!result) return 0;
  if (historical && result.historyInconclusive) {
    throw new PlatformBillingHistoricalCountInconclusive('HISTORICAL_EVIDENCE_LOST');
  }
  return Number(result.studentCount);
}

export class PlatformBillingHistoricalCountInconclusive extends Error {
  readonly reason: 'HISTORICAL_COVERAGE_UNAVAILABLE' | 'HISTORICAL_EVIDENCE_LOST' | 'HISTORICAL_DATA_INSUFFICIENT';

  constructor(reason: PlatformBillingHistoricalCountInconclusive['reason'] = 'HISTORICAL_DATA_INSUFFICIENT') {
    super('Historical platform billing student eligibility cannot be reconstructed safely.');
    this.name = 'PlatformBillingHistoricalCountInconclusive';
    this.reason = reason;
  }
}

export function assertCanManagePlatformBilling(canManage: boolean): NextResponse | null {
  if (canManage) return null;
  return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
}
