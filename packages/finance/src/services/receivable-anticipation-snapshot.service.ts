import type { AsaasAnticipation, AsaasAnticipationStatus } from '@alusa/asaas';
import { prisma } from '@alusa/database';

export type ReceivableAnticipationSnapshotSource =
  | 'LIST'
  | 'REQUEST'
  | 'CANCEL'
  | 'WEBHOOK';

export interface UpsertReceivableAnticipationSnapshotInput {
  contaId: string;
  anticipation: AsaasAnticipation;
  source: ReceivableAnticipationSnapshotSource;
  sourceWebhookId?: string | null;
  eventId?: string | null;
}

export interface ListReceivableAnticipationSnapshotsInput {
  contaId: string;
  page: number;
  pageSize: number;
  status?: AsaasAnticipationStatus;
  payment?: string;
  installment?: string;
  maxAgeMs: number;
}

export interface ReceivableAnticipationSnapshotsResult {
  items: AsaasAnticipation[];
  total: number;
  hasMore: boolean;
  fetchedAt: string;
}

export async function upsertReceivableAnticipationSnapshot(
  input: UpsertReceivableAnticipationSnapshotInput,
): Promise<void> {
  const now = new Date();
  const anticipation = input.anticipation;

  await prisma.receivableAnticipationSnapshot.upsert({
    where: {
      uq_receivable_anticipation_conta_asaas: {
        contaId: input.contaId,
        asaasAnticipationId: anticipation.id,
      },
    },
    create: {
      contaId: input.contaId,
      asaasAnticipationId: anticipation.id,
      status: anticipation.status,
      paymentId: anticipation.payment ?? null,
      installmentId: anticipation.installment ?? null,
      anticipationDate: parseAsaasDate(anticipation.anticipationDate),
      dueDate: parseAsaasDate(anticipation.dueDate),
      requestDate: parseAsaasDate(anticipation.requestDate),
      fee: nullableNumber(anticipation.fee),
      anticipationDays: nullableInteger(anticipation.anticipationDays),
      netValue: nullableNumber(anticipation.netValue),
      totalValue: nullableNumber(anticipation.totalValue),
      value: nullableNumber(anticipation.value),
      denialObservation: anticipation.denialObservation ?? null,
      source: input.source,
      sourceWebhookId: input.sourceWebhookId ?? null,
      eventId: input.eventId ?? null,
      raw: anticipation as unknown as object,
      fetchedAt: now,
      statusUpdatedAt: now,
    },
    update: {
      status: anticipation.status,
      paymentId: anticipation.payment ?? null,
      installmentId: anticipation.installment ?? null,
      anticipationDate: parseAsaasDate(anticipation.anticipationDate),
      dueDate: parseAsaasDate(anticipation.dueDate),
      requestDate: parseAsaasDate(anticipation.requestDate),
      fee: nullableNumber(anticipation.fee),
      anticipationDays: nullableInteger(anticipation.anticipationDays),
      netValue: nullableNumber(anticipation.netValue),
      totalValue: nullableNumber(anticipation.totalValue),
      value: nullableNumber(anticipation.value),
      denialObservation: anticipation.denialObservation ?? null,
      source: input.source,
      sourceWebhookId: input.sourceWebhookId ?? null,
      eventId: input.eventId ?? null,
      raw: anticipation as unknown as object,
      fetchedAt: now,
      statusUpdatedAt: now,
    },
  });
}

export async function listReceivableAnticipationSnapshots(
  input: ListReceivableAnticipationSnapshotsInput,
): Promise<ReceivableAnticipationSnapshotsResult | null> {
  const minFetchedAt = new Date(Date.now() - input.maxAgeMs);
  const where = {
    contaId: input.contaId,
    fetchedAt: { gte: minFetchedAt },
    ...(input.status ? { status: input.status } : {}),
    ...(input.payment ? { paymentId: input.payment } : {}),
    ...(input.installment ? { installmentId: input.installment } : {}),
  };

  const total = await prisma.receivableAnticipationSnapshot.count({ where });
  if (total === 0) return null;

  const rows = await prisma.receivableAnticipationSnapshot.findMany({
    where,
    orderBy: { statusUpdatedAt: 'desc' },
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  });

  const fetchedAt = rows.reduce<string | null>((latest, row) => {
    const current = row.fetchedAt.toISOString();
    return !latest || current > latest ? current : latest;
  }, null);

  return {
    items: rows.map(snapshotToAnticipation),
    total,
    hasMore: input.page * input.pageSize < total,
    fetchedAt: fetchedAt ?? new Date().toISOString(),
  };
}

function snapshotToAnticipation(row: {
  asaasAnticipationId: string;
  status: string;
  paymentId: string | null;
  installmentId: string | null;
  anticipationDate: Date | null;
  dueDate: Date | null;
  requestDate: Date | null;
  fee: unknown | null;
  anticipationDays: number | null;
  netValue: unknown | null;
  totalValue: unknown | null;
  value: unknown | null;
  denialObservation: string | null;
}): AsaasAnticipation {
  return {
    id: row.asaasAnticipationId,
    status: row.status as AsaasAnticipationStatus,
    payment: row.paymentId ?? undefined,
    installment: row.installmentId ?? undefined,
    anticipationDate: formatAsaasDate(row.anticipationDate),
    dueDate: formatAsaasDate(row.dueDate),
    requestDate: formatAsaasDate(row.requestDate),
    fee: Number(row.fee ?? 0),
    anticipationDays: row.anticipationDays ?? 0,
    netValue: Number(row.netValue ?? 0),
    totalValue: Number(row.totalValue ?? 0),
    value: Number(row.value ?? 0),
    denialObservation: row.denialObservation ?? undefined,
  };
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function parseAsaasDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatAsaasDate(value: Date | null): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}
