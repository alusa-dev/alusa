/**
 * Materializes local revenue obligations for legacy event registrations.
 *
 * The command is read-only by default. Applying changes requires an explicit
 * tenant and event because financial backfills must be reviewed event by
 * event. It preserves manual revenue entries without a participant link for
 * a separate reconciliation queue. Applying with such rows requires an
 * explicit --acknowledge-unlinked flag. No Asaas API is called.
 *
 * Examples:
 *   pnpm exec tsx scripts/backfill-event-financial-entries.ts --dry-run
 *   pnpm exec tsx scripts/backfill-event-financial-entries.ts --dry-run --conta-id=<id> --event-id=<id>
 *   pnpm exec tsx scripts/backfill-event-financial-entries.ts --apply --acknowledge-unlinked --conta-id=<id> --event-id=<id>
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const acknowledgeUnlinked = process.argv.includes('--acknowledge-unlinked');
const contaId = process.argv.find((arg) => arg.startsWith('--conta-id='))?.split('=')[1];
const eventId = process.argv.find((arg) => arg.startsWith('--event-id='))?.split('=')[1];

type Candidate = {
  id: string;
  contaId: string;
  eventId: string;
  registrationFeeCharged: { toNumber(): number };
  registrationFeeOriginal: { toNumber(): number };
  registrationFeeDiscount: { toNumber(): number };
  feePaidAmount: { toNumber(): number };
  isFeePaid: boolean;
  asaasPaymentId: string | null;
  asaasInstallmentId: string | null;
  billingGroupId: string | null;
};

type UnlinkedEntry = {
  id: string;
  eventId: string;
  expectedAmount: { toNumber(): number };
  actualAmount: { toNumber(): number } | null;
  status: string;
};

type GroupIssue = {
  billingGroupId: string;
  expected: number;
  participantsTotal: number;
};

function parseRequiredScope() {
  if (apply && (!contaId || !eventId)) {
    throw new Error('O modo --apply exige --conta-id=<id> e --event-id=<id>.');
  }
}

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

async function loadCandidates(): Promise<Candidate[]> {
  return prisma.eventParticipant.findMany({
    where: {
      ...(contaId ? { contaId } : {}),
      ...(eventId ? { eventId } : {}),
      cancelledAt: null,
      revenueEntryId: null,
      registrationFeeCharged: { gt: 0 },
    },
    select: {
      id: true,
      contaId: true,
      eventId: true,
      registrationFeeCharged: true,
      registrationFeeOriginal: true,
      registrationFeeDiscount: true,
      feePaidAmount: true,
      isFeePaid: true,
      asaasPaymentId: true,
      asaasInstallmentId: true,
      billingGroupId: true,
    },
    orderBy: [{ contaId: 'asc' }, { eventId: 'asc' }, { id: 'asc' }],
  }) as unknown as Candidate[];
}

async function loadUnlinkedEntries(candidates: Candidate[]): Promise<UnlinkedEntry[]> {
  const eventIds = [...new Set(candidates.map((candidate) => candidate.eventId))];
  const contaIds = [...new Set(candidates.map((candidate) => candidate.contaId))];
  if (eventIds.length === 0) return [];

  const linkedParticipants = await prisma.eventParticipant.findMany({
    where: {
      eventId: { in: eventIds },
      contaId: { in: contaIds },
      revenueEntryId: { not: null },
    },
    select: { revenueEntryId: true },
  });
  const linkedEntryIds = new Set(
    linkedParticipants
      .map((participant) => participant.revenueEntryId)
      .filter((id): id is string => Boolean(id)),
  );

  const entries = await prisma.eventFinancialEntry.findMany({
    where: {
      eventId: { in: eventIds },
      contaId: { in: contaIds },
      type: 'REVENUE',
      originType: 'MANUAL',
      originId: null,
    },
    select: {
      id: true,
      eventId: true,
      expectedAmount: true,
      actualAmount: true,
      status: true,
    },
    orderBy: [{ eventId: 'asc' }, { id: 'asc' }],
  }) as unknown as UnlinkedEntry[];

  return entries.filter((entry) => !linkedEntryIds.has(entry.id));
}

async function loadGroupIssues(candidates: Candidate[]): Promise<GroupIssue[]> {
  const groupIds = [...new Set(candidates.map((candidate) => candidate.billingGroupId).filter((id): id is string => Boolean(id)))];
  if (groupIds.length === 0) return [];

  const groups = await prisma.eventBillingGroup.findMany({
    where: {
      ...(contaId ? { contaId } : {}),
      id: { in: groupIds },
    },
    select: {
      id: true,
      totalAmount: true,
      participants: {
        where: { cancelledAt: null },
        select: { registrationFeeCharged: true },
      },
    },
  });

  return groups.flatMap((group) => {
    const participantsTotal = group.participants.reduce(
      (sum, participant) => sum + participant.registrationFeeCharged.toNumber(),
      0,
    );
    return cents(participantsTotal) === cents(group.totalAmount.toNumber())
      ? []
      : [{
          billingGroupId: group.id,
          expected: group.totalAmount.toNumber(),
          participantsTotal,
        }];
  });
}

async function loadExistingMaterializations(candidates: Candidate[]) {
  const ids = candidates.map((candidate) => candidate.id);
  if (ids.length === 0) return new Map<string, { id: string; eventId: string; expectedAmount: { toNumber(): number } }>();

  const entries = await prisma.eventFinancialEntry.findMany({
    where: {
      contaId: contaId ?? undefined,
      originType: 'MANUAL',
      originId: { in: ids },
      type: 'REVENUE',
    },
    select: { id: true, eventId: true, originId: true, expectedAmount: true },
  });

  return new Map(entries.map((entry) => [entry.originId as string, entry]));
}

function report(
  candidates: Candidate[],
  unlinkedEntries: UnlinkedEntry[],
  groupIssues: GroupIssue[],
  existing: Map<string, { id: string }>,
) {
  const candidateTotal = candidates.reduce((sum, candidate) => sum + candidate.registrationFeeCharged.toNumber(), 0);
  const unlinkedTotal = unlinkedEntries.reduce((sum, entry) => sum + entry.expectedAmount.toNumber(), 0);
  const byEvent = new Map<string, { candidates: number; candidateTotal: number; unlinked: number; unlinkedTotal: number }>();

  for (const candidate of candidates) {
    const current = byEvent.get(candidate.eventId) ?? { candidates: 0, candidateTotal: 0, unlinked: 0, unlinkedTotal: 0 };
    current.candidates += 1;
    current.candidateTotal += candidate.registrationFeeCharged.toNumber();
    byEvent.set(candidate.eventId, current);
  }
  for (const entry of unlinkedEntries) {
    const current = byEvent.get(entry.eventId) ?? { candidates: 0, candidateTotal: 0, unlinked: 0, unlinkedTotal: 0 };
    current.unlinked += 1;
    current.unlinkedTotal += entry.expectedAmount.toNumber();
    byEvent.set(entry.eventId, current);
  }

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: ${candidates.length} inscrição(ões) sem lançamento.`);
  console.log(`Total líquido das obrigações: R$ ${formatMoney(candidateTotal)}.`);
  console.log(`Lançamentos manuais sem vínculo: ${unlinkedEntries.length} (R$ ${formatMoney(unlinkedTotal)} esperados).`);
  console.log(`Materializações idempotentes já existentes: ${existing.size}.`);
  console.log(`Inconsistências de cobrança agrupada: ${groupIssues.length}.`);

  for (const [currentEventId, values] of byEvent) {
    const ambiguous = values.unlinked > 0 || groupIssues.length > 0;
    console.log(
      `- evento=${currentEventId} | candidatos=${values.candidates} (R$ ${formatMoney(values.candidateTotal)}) | `
      + `sem vínculo=${values.unlinked} (R$ ${formatMoney(values.unlinkedTotal)}) | `
      + `situação=${ambiguous ? 'REVISÃO OBRIGATÓRIA' : 'APTO PARA REVISÃO FINAL'}`,
    );
  }

  for (const issue of groupIssues) {
    console.log(
      `  - grupo=${issue.billingGroupId} | total do grupo=R$ ${formatMoney(issue.expected)} | `
      + `soma das inscrições=R$ ${formatMoney(issue.participantsTotal)}`,
    );
  }

  for (const candidate of candidates) {
    console.log(
      `  - inscrição=${candidate.id} | líquido=R$ ${formatMoney(candidate.registrationFeeCharged.toNumber())} | `
      + `grupo=${candidate.billingGroupId ?? 'nenhum'} | `
      + `asaas=${candidate.asaasPaymentId || candidate.asaasInstallmentId ? 'sim' : 'não'}`,
    );
  }
}

async function applyCandidates(
  candidates: Candidate[],
  unlinkedEntries: UnlinkedEntry[],
  groupIssues: GroupIssue[],
) {
  if (unlinkedEntries.length > 0 && !acknowledgeUnlinked) {
    throw new Error(
      `Backfill bloqueado: existem ${unlinkedEntries.length} lançamento(s) manual(is) sem vínculo no escopo. `
      + 'Use --acknowledge-unlinked somente após registrar a revisão desses lançamentos.',
    );
  }
  if (groupIssues.length > 0) {
    throw new Error('Backfill bloqueado: há cobrança(s) agrupada(s) cuja soma não corresponde às inscrições.');
  }
  if (candidates.length === 0) return;
  if (!contaId || !eventId) throw new Error('Escopo obrigatório ausente.');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`event-financial-backfill:${contaId}:${eventId}`}, 0))`;

    const currentUnlinkedCount = await tx.eventFinancialEntry.count({
      where: { contaId, eventId, type: 'REVENUE', originType: 'MANUAL', originId: null },
    });
    if (currentUnlinkedCount > 0 && !acknowledgeUnlinked) {
      throw new Error(
        `Backfill bloqueado dentro da transação: existem ${currentUnlinkedCount} lançamento(s) manual(is) sem vínculo.`,
      );
    }

    let created = 0;
    let linked = 0;
    for (const candidate of candidates) {
      const current = await tx.eventParticipant.findFirst({
        where: { id: candidate.id, contaId, eventId, revenueEntryId: null, cancelledAt: null },
        select: {
          id: true,
          eventId: true,
          registrationFeeCharged: true,
          registrationFeeOriginal: true,
          registrationFeeDiscount: true,
          feePaidAmount: true,
          isFeePaid: true,
          asaasPaymentId: true,
          asaasInstallmentId: true,
        },
      });
      if (!current) continue;

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`event-participant-backfill:${contaId}:${current.id}`}, 0))`;

      const existing = await tx.eventFinancialEntry.findFirst({
        where: { contaId, eventId, type: 'REVENUE', originType: 'MANUAL', originId: current.id },
        select: { id: true, expectedAmount: true },
      });
      if (existing) {
        if (cents(existing.expectedAmount.toNumber()) !== cents(current.registrationFeeCharged.toNumber())) {
          throw new Error(`Materialização existente com valor divergente para a inscrição ${current.id}.`);
        }
        await tx.eventParticipant.update({ where: { id: current.id }, data: { revenueEntryId: existing.id } });
        linked += 1;
        continue;
      }

      const expected = current.registrationFeeCharged;
      const paid = current.feePaidAmount.toNumber() > 0
        ? current.feePaidAmount
        : current.isFeePaid ? expected : null;
      const fullyPaid = paid != null && paid.toNumber() >= expected.toNumber();
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId,
          eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição (backfill financeiro)',
          originType: 'MANUAL',
          originId: current.id,
          expectedAmount: expected,
          grossAmount: current.registrationFeeOriginal.toNumber() > 0 ? current.registrationFeeOriginal : expected,
          discountAmount: current.registrationFeeDiscount,
          actualAmount: paid,
          netAmount: paid,
          refundedAmount: 0,
          status: fullyPaid ? 'RECEIVED' : 'PENDING',
          paymentProvider: current.asaasPaymentId || current.asaasInstallmentId ? 'ASAAS' : null,
          asaasPaymentId: current.asaasPaymentId ?? current.asaasInstallmentId ?? null,
          paymentStatus: fullyPaid ? 'RECEIVED' : current.asaasPaymentId || current.asaasInstallmentId ? 'PENDING' : null,
        },
      });
      await tx.eventParticipant.update({ where: { id: current.id }, data: { revenueEntryId: entry.id } });
      await tx.eventAudit.create({
        data: {
          contaId,
          eventId,
          actorUserId: null,
          action: 'events.finance.backfill_registration_entry',
          entityType: 'EventFinancialEntry',
          entityId: entry.id,
          metadata: {
            source: 'backfill-event-financial-entries',
            participantId: current.id,
            unlinkedRevenueEntries: unlinkedEntries.length,
            acknowledgedUnlinked,
            idempotencyKey: `event-financial-backfill:${contaId}:${current.id}`,
          },
        },
      });
      created += 1;
    }

    console.log(`Aplicação concluída: ${created} lançamento(s) criado(s), ${linked} vínculo(s) reutilizado(s).`);
  });
}

async function main() {
  parseRequiredScope();
  const candidates = await loadCandidates();
  const unlinkedEntries = await loadUnlinkedEntries(candidates);
  const groupIssues = await loadGroupIssues(candidates);
  const existing = await loadExistingMaterializations(candidates);
  report(candidates, unlinkedEntries, groupIssues, existing);

  if (!apply) return;
  await applyCandidates(candidates, unlinkedEntries, groupIssues);
}

main()
  .catch((error) => {
    console.error('Falha no backfill financeiro de Eventos:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
