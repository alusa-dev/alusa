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
    if (!historyCoverage || deletionAfterClose) throw new PlatformBillingHistoricalCountInconclusive();
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
    throw new PlatformBillingHistoricalCountInconclusive();
  }
  return Number(result.studentCount);
}

export class PlatformBillingHistoricalCountInconclusive extends Error {
  constructor() {
    super('Historical platform billing student eligibility cannot be reconstructed safely.');
    this.name = 'PlatformBillingHistoricalCountInconclusive';
  }
}

export function assertCanManagePlatformBilling(canManage: boolean): NextResponse | null {
  if (canManage) return null;
  return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
}
