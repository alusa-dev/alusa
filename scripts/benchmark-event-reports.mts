import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { getEventReportDetail } from '../packages/lib/src/events/event-report-detail.service.ts';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
if (databaseUrl.hostname !== 'localhost' || databaseName !== 'alusa_test') {
  throw new Error('Event report benchmark only runs against localhost/alusa_test.');
}

const suffix = randomUUID().replaceAll('-', '');
const contaId = `event-bench-conta-${suffix}`;
const contaBId = `event-bench-conta-b-${suffix}`;
const eventCount = Number(process.env.EVENT_REPORT_BENCH_EVENTS ?? 20);
const childrenPerRelation = Number(process.env.EVENT_REPORT_BENCH_CHILDREN ?? 10);
if (!Number.isInteger(eventCount) || eventCount < 1 || eventCount > 100) {
  throw new Error('EVENT_REPORT_BENCH_EVENTS must be an integer from 1 to 100.');
}
if (!Number.isInteger(childrenPerRelation) || childrenPerRelation < 1 || childrenPerRelation > 250) {
  throw new Error('EVENT_REPORT_BENCH_CHILDREN must be an integer from 1 to 250.');
}
const benchmarkError = new Error('ROLLBACK_EVENT_REPORT_BENCHMARK_FIXTURE');
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let activeQueries: Array<{ duration: number; query: string }> | null = null;
prisma.$on('query', (event) => activeQueries?.push({ duration: event.duration, query: event.query }));
const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
if (!collectGarbage) {
  throw new Error('Run this benchmark with Node.js --expose-gc to measure retained heap consistently.');
}

const eventParticipantScalarSelect = {
  id: true,
  contaId: true,
  eventId: true,
  type: true,
  alunoId: true,
  turmaId: true,
  responsavelId: true,
  displayName: true,
  notes: true,
  registrationFeeCharged: true,
  registrationFeeOriginal: true,
  registrationFeeDiscount: true,
  registrationFeeDiscountType: true,
  billingMode: true,
  entryAmount: true,
  balanceAmount: true,
  entryPaymentMethod: true,
  billingGroupId: true,
  registrationPaymentRules: true,
  isFeePaid: true,
  isFeeExempt: true,
  feePaymentMethod: true,
  revenueEntryId: true,
  financialStatusSnapshot: true,
  feePaidAmount: true,
  feeRefundedAmount: true,
  standaloneChargeId: true,
  asaasPaymentId: true,
  asaasInstallmentId: true,
  cancelledAt: true,
  cancelledReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventParticipantSelect;

// Baseline projection from HEAD before the report-specific select was added.
const baselineInclude = {
  responsibleUser: { select: { id: true, nome: true, email: true } },
  createdBy: { select: { id: true, nome: true, email: true } },
  ticketLots: true,
  ticketSales: true,
  costumes: true,
  assignments: true,
  financialEntries: true,
  participants: { select: eventParticipantScalarSelect },
} satisfies Prisma.SchoolEventInclude;

// Current report-specific projection from packages/lib/src/events/events.service.ts.
const reportSelect = {
  id: true,
  contaId: true,
  name: true,
  ticketArtworkUrl: true,
  description: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  locationName: true,
  locationAddress: true,
  estimatedCapacity: true,
  responsibleUserId: true,
  createdByUserId: true,
  hasTickets: true,
  ticketMode: true,
  hasCostumes: true,
  hasFinancialControl: true,
  notes: true,
  registrationFee: true,
  paymentInterestValue: true,
  paymentFineValue: true,
  paymentFineType: true,
  paymentDiscountValue: true,
  paymentDiscountType: true,
  paymentDiscountDueDateLimitDays: true,
  contratoModeloId: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  finishedAt: true,
  archivedAt: true,
  responsibleUser: {
    select: {
      id: true,
      nome: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      nome: true,
    },
  },
  ticketSales: { where: { contaId }, select: { status: true, quantity: true, totalAmount: true } },
  ticketLots: { where: { contaId }, select: { quantityTotal: true, quantitySold: true, unitPrice: true } },
  costumes: { where: { contaId }, select: { id: true, schoolCost: true, quantity: true } },
  assignments: { where: { contaId }, select: { revenueEntryId: true, status: true, billingMode: true, chargedValue: true, isPaid: true } },
  financialEntries: {
    where: { contaId },
    select: {
      id: true,
      type: true,
      status: true,
      expectedAmount: true,
      grossAmount: true,
      discountAmount: true,
      netAmount: true,
      actualAmount: true,
      refundedAmount: true,
      originType: true,
      originId: true,
      costClass: true,
      category: true,
      asaasPaymentId: true,
      realizedAt: true,
    },
  },
  participants: {
    where: { contaId },
    select: {
      id: true,
      revenueEntryId: true,
      asaasPaymentId: true,
      asaasInstallmentId: true,
      billingGroupId: true,
      balanceAmount: true,
      registrationFeeCharged: true,
      registrationFeeOriginal: true,
      registrationFeeDiscount: true,
      feePaidAmount: true,
      feeRefundedAmount: true,
      isFeePaid: true,
      isFeeExempt: true,
      cancelledAt: true,
    },
  },
} satisfies Prisma.SchoolEventSelect;

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function summarizePlan(plan: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeType: plan['Node Type'],
    relation: plan['Relation Name'],
    index: plan['Index Name'],
    estimatedRows: plan['Plan Rows'],
    actualRows: plan['Actual Rows'],
    actualLoops: plan['Actual Loops'],
    actualMs: plan['Actual Total Time'],
    sharedHitBlocks: plan['Shared Hit Blocks'],
    sharedReadBlocks: plan['Shared Read Blocks'],
    children: Array.isArray(plan['Plans'])
      ? plan['Plans'].map((child) => summarizePlan(child as Record<string, unknown>))
      : [],
  };
}

async function explainReportReads(tx: Prisma.TransactionClient, eventIds: string[]) {
  const queries = [
    {
      name: 'SchoolEvent by tenant and startsAt',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "startsAt" FROM "SchoolEvent"
        WHERE "contaId" = $1 ORDER BY "startsAt" DESC`,
      params: [contaId],
    },
    {
      name: 'EventParticipant by tenant and event',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "eventId", "type" FROM "EventParticipant"
        WHERE "contaId" = $1 AND "eventId" = ANY($2::text[])`,
      params: [contaId, eventIds],
    },
    {
      name: 'EventFinancialEntry by tenant and event',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "eventId", "type", "status", "expectedAmount", "actualAmount" FROM "EventFinancialEntry"
        WHERE "contaId" = $1 AND "eventId" = ANY($2::text[])`,
      params: [contaId, eventIds],
    },
    {
      name: 'EventTicketSale by tenant and event',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "eventId", "status", "quantity", "totalAmount" FROM "EventTicketSale"
        WHERE "contaId" = $1 AND "eventId" = ANY($2::text[])`,
      params: [contaId, eventIds],
    },
  ];

  return Promise.all(queries.map(async ({ name, sql, params }) => {
    const result = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: Record<string, unknown> }> }>>(sql, ...params);
    return { name, plan: summarizePlan(result[0]?.['QUERY PLAN']?.[0]?.Plan ?? {}) };
  }));
}

async function measure(
  tx: Prisma.TransactionClient,
  projection: { include: Prisma.SchoolEventInclude } | { select: Prisma.SchoolEventSelect },
  includeMembershipLookup = false,
  rounds = 5,
) {
  const wallTimes: number[] = [];
  const dbTimes: number[] = [];
  const queryCounts: number[] = [];
  const payloadBytes: number[] = [];
  const heapDeltaBytes: number[] = [];

  for (let round = 0; round < rounds + 1; round += 1) {
    const queries: Array<{ duration: number; query: string }> = [];
    activeQueries = queries;
    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const events = await tx.schoolEvent.findMany({
      where: { contaId },
      ...projection,
      orderBy: { startsAt: 'desc' },
    });
    const memberships = includeMembershipLookup
      ? await tx.usuarioConta.findMany({
        where: {
          contaId,
          usuarioId: { in: [...new Set(events.flatMap((event) => [event.responsibleUser?.id, event.createdBy?.id]).filter((id): id is string => Boolean(id)))] },
          status: 'ATIVO',
        },
        select: { usuarioId: true },
      })
      : [];
    const elapsed = performance.now() - startedAt;
    const heapAfterRead = process.memoryUsage().heapUsed;
    activeQueries = null;

    if (round === 0) continue; // Warm the local connection and query plans.
    wallTimes.push(elapsed);
    dbTimes.push(queries.reduce((sum, query) => sum + query.duration, 0));
    queryCounts.push(queries.length);
    payloadBytes.push(bytes({ events, memberships }));
    heapDeltaBytes.push(Math.max(heapAfterRead - heapBefore, 0));
  }

  return {
    rounds,
    medianWallMs: Number(median(wallTimes).toFixed(2)),
    medianDatabaseMs: median(dbTimes),
    queryCountPerRead: median(queryCounts),
    serializedResultBytes: median(payloadBytes),
    heapUsedDeltaBytes: median(heapDeltaBytes),
  };
}

async function measureDetail(tx: Prisma.TransactionClient, eventId: string, rounds = 5) {
  const wallTimes: number[] = [];
  const dbTimes: number[] = [];
  const queryCounts: number[] = [];
  const payloadBytes: number[] = [];
  const heapDeltaBytes: number[] = [];

  for (let round = 0; round < rounds + 1; round += 1) {
    const queries: Array<{ duration: number; query: string }> = [];
    activeQueries = queries;
    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const report = await getEventReportDetail(contaId, eventId, tx);
    const elapsed = performance.now() - startedAt;
    const heapAfterRead = process.memoryUsage().heapUsed;
    activeQueries = null;

    if (round === 0) continue;
    wallTimes.push(elapsed);
    dbTimes.push(queries.reduce((sum, query) => sum + query.duration, 0));
    queryCounts.push(queries.length);
    payloadBytes.push(bytes(report));
    heapDeltaBytes.push(Math.max(heapAfterRead - heapBefore, 0));
  }

  return {
    rounds,
    medianWallMs: Number(median(wallTimes).toFixed(2)),
    medianDatabaseMs: median(dbTimes),
    queryCountPerRead: median(queryCounts),
    serializedResultBytes: median(payloadBytes),
    heapUsedDeltaBytes: median(heapDeltaBytes),
  };
}

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.conta.createMany({
        data: [
          { id: contaId, nome: 'Temporary event report benchmark account A' },
          { id: contaBId, nome: 'Temporary event report benchmark account B' },
        ],
      });
      const user = await tx.usuario.create({
        data: {
          contaId,
          nome: 'Temporary event report benchmark user',
          email: `event-benchmark-${suffix}@example.invalid`,
          senhaHash: 'benchmark-only',
        },
        select: { id: true },
      });
      await tx.usuarioConta.create({ data: { usuarioId: user.id, contaId, role: 'RESPONSAVEL', status: 'ATIVO' } });

      const eventIds = Array.from({ length: eventCount }, (_, i) => `event-bench-${suffix}-${i}`);
      await tx.schoolEvent.createMany({
        data: eventIds.map((id, i) => ({
          id,
          contaId,
          name: `Benchmark Event ${i} ${'x'.repeat(40)}`,
          type: 'OTHER',
          startsAt: new Date(Date.UTC(2026, 0, 1 + i)),
          responsibleUserId: user.id,
          createdByUserId: user.id,
          description: 'Temporary description '.repeat(12),
          notes: 'Temporary notes with no personal data '.repeat(12),
        })),
      });

      const lotIds = eventIds.map((_, i) => `event-bench-lot-${suffix}-${i}`);
      await tx.eventTicketLot.createMany({
        data: eventIds.map((eventId, i) => ({
          id: lotIds[i],
          contaId,
          eventId,
          name: `Lot ${i}`,
          ticketType: 'FULL',
          unitPrice: 20,
          quantityTotal: 100,
          notes: 'Temporary lot notes '.repeat(8),
        })),
      });

      await tx.eventParticipant.createMany({
        data: eventIds.flatMap((eventId, eventIndex) => Array.from({ length: childrenPerRelation }, (_, i) => ({
          id: `event-bench-participant-${suffix}-${eventIndex}-${i}`,
          contaId,
          eventId,
          type: 'GUEST',
          displayName: `Temporary participant ${i} ${'name '.repeat(8)}`,
          notes: 'Temporary participant notes; no personal data. '.repeat(8),
          registrationFeeCharged: 50,
          registrationFeeOriginal: 60,
          registrationFeeDiscount: 10,
          registrationPaymentRules: { installments: 3, note: 'benchmark fixture only' },
          balanceAmount: 50,
        }))),
      });

      await tx.eventFinancialEntry.createMany({
        data: eventIds.flatMap((eventId, eventIndex) => Array.from({ length: childrenPerRelation }, (_, i) => ({
          id: `event-bench-entry-${suffix}-${eventIndex}-${i}`,
          contaId,
          eventId,
          type: 'REVENUE',
          category: `Category ${i}`,
          description: `Temporary financial entry ${i} ${'details '.repeat(12)}`,
          supplier: `Temporary supplier ${i}`,
          notes: 'Temporary financial notes; no personal data. '.repeat(8),
          expectedAmount: 50,
          actualAmount: 50,
          status: 'RECEIVED',
          originType: 'MANUAL',
        }))),
      });

      await tx.eventTicketSale.createMany({
        data: eventIds.flatMap((eventId, eventIndex) => Array.from({ length: childrenPerRelation }, (_, i) => ({
          id: `event-bench-sale-${suffix}-${eventIndex}-${i}`,
          contaId,
          eventId,
          lotId: lotIds[eventIndex],
          buyerName: `Temporary Buyer ${i}`,
          buyerEmail: `temporary-buyer-${i}@example.invalid`,
          buyerPhone: '0000000000',
          quantity: 1,
          unitPriceSnapshot: 20,
          totalAmount: 20,
          paymentMethod: 'MANUAL_PIX',
          status: 'PAID',
          paidAt: new Date(Date.UTC(2026, 0, 2)),
          notes: 'Temporary ticket sale notes; no personal data. '.repeat(8),
        }))),
      });

      await tx.$executeRawUnsafe('ANALYZE "SchoolEvent", "EventParticipant", "EventFinancialEntry", "EventTicketSale"');
      const explainPlans = await explainReportReads(tx, eventIds);
      const baseline = await measure(tx, { include: baselineInclude });
      const reportProjection = await measure(tx, { select: reportSelect }, true);
      const detailReport = await measureDetail(tx, eventIds[0]!);
      console.log(JSON.stringify({
        database: databaseName,
        fixture: {
          events: eventCount,
          participants: eventCount * childrenPerRelation,
          financialEntries: eventCount * childrenPerRelation,
          ticketSales: eventCount * childrenPerRelation,
          ticketLots: eventCount,
        },
        explainAnalyze: explainPlans,
        baseline,
        reportProjection,
        detailReport,
        note: 'Local synthetic fixture, list and detail reads use five measured rounds after one warmup. Node.js heap delta is sampled immediately after each read and before payload serialization or forced cleanup (not peak RSS). The transaction is rolled back. Timing and heap are diagnostic, not production benchmark evidence.',
      }, null, 2));

      throw benchmarkError;
    }, { timeout: 60_000 });
  } catch (error) {
    if (error !== benchmarkError) throw error;
    // Restore planner statistics for the now-empty temporary tenant fixture.
    await prisma.$executeRawUnsafe('ANALYZE "SchoolEvent", "EventParticipant", "EventFinancialEntry", "EventTicketSale"');
  } finally {
    activeQueries = null;
    await prisma.$disconnect();
  }
}

await main();
