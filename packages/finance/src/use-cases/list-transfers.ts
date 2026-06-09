import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getTransfer as asaasGetTransfer } from '@alusa/asaas';

import {
  extractWebhookTransferMetadata,
  mergeTransferMetadata,
  resolveOfficialFeeValue,
  resolveOfficialNetValue,
  resolveTransferMetadata,
  type TransferWebhookMetadata,
} from './transfers/transfer-metadata';
import { reconcileOpenTransfers } from './transfers/reconcile-open-transfers';

const OPEN_TRANSFER_RECONCILIATION_LIMIT = 20;

export type ListTransfersInput = {
  contaId: string;
  limit: number;
  offset: number;
  status?: string;
  search?: string;
  operation?: 'PIX' | 'TED';
  from?: string;
  to?: string;
  direction: 'asc' | 'desc';
};

export type TransferListItem = {
  id: string;
  externalReference: string;
  asaasTransferId: string | null;
  value: number;
  feeValue: number | null;
  netValue: number;
  status: string;
  operation: 'PIX' | 'TED';
  recipientName: string | null;
  cpfCnpjMasked: string | null;
  bankName: string | null;
  scheduleDate: string | null;
  transferDate: string | null;
  description: string | null;
  statusUpdatedAt: string;
  createdAt: string;
};

export type ListTransfersOutput = { items: TransferListItem[]; total: number };

function normalizeSearch(value: string | undefined) {
  return value?.trim().toLocaleLowerCase('pt-BR') ?? '';
}

function isWithinRange(value: string | null, from?: string, to?: string) {
  if (!value) return false;

  const [datePart] = value.split('T');
  if (!datePart) return false;
  if (from && datePart < from) return false;
  if (to && datePart > to) return false;
  return true;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNumberOrFallback(value: unknown, fallback: number): number {
  return toNumberOrNull(value) ?? fallback;
}

export async function listTransfers(input: ListTransfersInput): Promise<ListTransfersOutput> {
  const credentials = await loadAsaasCredentials(input.contaId);

  const { officialTransfersById } = await reconcileOpenTransfers({
    contaId: input.contaId,
    limit: OPEN_TRANSFER_RECONCILIATION_LIMIT,
  });

  const rows = await prisma.transferRequest.findMany({
    where: {
      contaId: input.contaId,
      ...(input.status ? { status: input.status as never } : {}),
    },
    orderBy: { createdAt: input.direction },
    select: {
      id: true,
      externalReference: true,
      asaasTransferId: true,
      value: true,
      feeValue: true,
      netValue: true,
      destination: true,
      description: true,
      scheduleDate: true,
      status: true,
      statusUpdatedAt: true,
      createdAt: true,
    },
  });

  const webhookPayloadByTransferId = new Map<string, TransferWebhookMetadata>();

  const asaasTransferIds = Array.from(
    new Set(rows.map((item) => item.asaasTransferId).filter((value): value is string => Boolean(value))),
  );

  if (asaasTransferIds.length > 0) {
    const transferWebhooks = await prisma.webhookAsaas.findMany({
      where: {
        contaId: input.contaId,
        asaasTransferId: { in: asaasTransferIds },
      },
      orderBy: { recebidoEm: 'desc' },
      select: {
        asaasTransferId: true,
        payload: true,
      },
    });

    for (const webhook of transferWebhooks) {
      if (!webhook.asaasTransferId || webhookPayloadByTransferId.has(webhook.asaasTransferId)) {
        continue;
      }

      const metadata = extractWebhookTransferMetadata(webhook.payload);
      if (!metadata) continue;

      webhookPayloadByTransferId.set(webhook.asaasTransferId, metadata);
    }
  }

  const search = normalizeSearch(input.search);

  const filteredRows = rows.filter((item) => {
    const metadata = mergeTransferMetadata(
      resolveTransferMetadata(item.destination, item.description ?? null),
      item.asaasTransferId ? webhookPayloadByTransferId.get(item.asaasTransferId) ?? null : null,
    );
    const transferDate = item.statusUpdatedAt?.toISOString() ?? null;
    const scheduleDate = item.scheduleDate?.toISOString() ?? null;

    if (input.operation && metadata.operation !== input.operation) return false;
    if ((input.from || input.to) && !isWithinRange(transferDate ?? scheduleDate ?? item.createdAt.toISOString(), input.from, input.to)) {
      return false;
    }

    if (!search) return true;

    const haystack = [
      item.externalReference,
      item.description ?? '',
      metadata.recipientName ?? '',
      metadata.cpfCnpjMasked ?? '',
      metadata.bankName ?? '',
      metadata.operation,
    ]
      .join(' ')
      .toLocaleLowerCase('pt-BR');

    return haystack.includes(search);
  });

  const total = filteredRows.length;
  const items = filteredRows.slice(input.offset, input.offset + input.limit);

  if (credentials) {
    // Only fetch live data for items that still need fee resolution from Asaas
    const pagedTransferIds = items
      .map((item) => item.asaasTransferId)
      .filter(
        (value): value is string =>
          typeof value === 'string' &&
          !officialTransfersById.has(value) &&
          !items.find((i) => i.asaasTransferId === value && i.feeValue != null && i.netValue != null),
      );

    if (pagedTransferIds.length > 0) {
      const uniquePagedTransferIds = Array.from(new Set(pagedTransferIds));
      const officialTransfers = await Promise.allSettled(
        uniquePagedTransferIds.map(async (transferId) => {
          const transfer = await asaasGetTransfer({ apiKey: credentials.apiKey, id: transferId });
          return { transferId, transfer };
        }),
      );

      for (const result of officialTransfers) {
        if (result.status !== 'fulfilled') continue;
        officialTransfersById.set(result.value.transferId, result.value.transfer);
      }
    }
  }

  return {
    total,
    items: items.map((item) => {
      const webhookMeta = item.asaasTransferId ? webhookPayloadByTransferId.get(item.asaasTransferId) ?? null : null;
      const metadata = mergeTransferMetadata(
        resolveTransferMetadata(item.destination, item.description ?? null),
        webhookMeta,
      );
      const officialTransfer = item.asaasTransferId ? officialTransfersById.get(item.asaasTransferId) ?? null : null;
      const persistedGrossValue = toNumberOrFallback(item.value, 0);
      const grossValue = toNumberOrFallback(officialTransfer?.value, persistedGrossValue);
      // Prefer persisted DB values; fall back to live GET / webhook resolution
      const feeValue =
        item.feeValue != null
          ? toNumberOrFallback(item.feeValue, 0)
          : resolveOfficialFeeValue(officialTransfer, webhookMeta, grossValue);
      const netValue =
        item.netValue != null
          ? toNumberOrFallback(item.netValue, grossValue)
          : resolveOfficialNetValue(officialTransfer, webhookMeta, grossValue);

      return {
        id: item.id,
        externalReference: item.externalReference,
        asaasTransferId: item.asaasTransferId ?? null,
        value: grossValue,
        feeValue,
        netValue,
        status: item.status,
        operation: metadata.operation,
        recipientName: metadata.recipientName,
        cpfCnpjMasked: metadata.cpfCnpjMasked,
        bankName: metadata.bankName,
        scheduleDate: item.scheduleDate?.toISOString() ?? null,
        transferDate: officialTransfer?.effectiveDate ?? item.statusUpdatedAt?.toISOString() ?? null,
        description: item.description ?? null,
        statusUpdatedAt: item.statusUpdatedAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
      };
    }),
  };
}
