import { prisma } from '@alusa/database';

import { mergePixRecipientMetadata, parseWithdrawDestination, summarizeWithdrawDestination } from './transfers/recipient-utils';
import type { WithdrawDestination } from './request-withdraw';

export interface ListTransferRecipientsInput {
  contaId: string;
  limit?: number;
}

export interface TransferRecipientItem {
  id: string;
  type: WithdrawDestination['type'];
  label: string;
  detail: string;
  lastUsedAt: string;
  destination: WithdrawDestination;
}

export interface ListTransferRecipientsOutput {
  items: TransferRecipientItem[];
}

const DEFAULT_SCAN_LIMIT = 100;

export async function listTransferRecipients(
  input: ListTransferRecipientsInput,
): Promise<ListTransferRecipientsOutput> {
  const rows = await prisma.transferRequest.findMany({
    where: { contaId: input.contaId },
    orderBy: { createdAt: 'desc' },
    take: Math.max(input.limit ?? DEFAULT_SCAN_LIMIT, DEFAULT_SCAN_LIMIT),
    select: {
      id: true,
      destination: true,
      createdAt: true,
      pixTransferSession: {
        select: {
          recipientName: true,
          recipientDocumentMasked: true,
          recipientBank: true,
          recipientPixKeyMasked: true,
        },
      },
    },
  });

  const unique = new Map<string, TransferRecipientItem>();

  for (const row of rows) {
    const rawDestination = parseWithdrawDestination(row.destination);
    if (!rawDestination) continue;

    if (rawDestination.type === 'PIX' && rawDestination.saveRecipient === false) {
      continue;
    }

    const destination = mergePixRecipientMetadata(rawDestination, row.pixTransferSession);

    const summary = summarizeWithdrawDestination(destination);
    if (unique.has(summary.key)) continue;

    unique.set(summary.key, {
      id: summary.key,
      type: summary.type,
      label: summary.label,
      detail: summary.detail,
      lastUsedAt: row.createdAt.toISOString(),
      destination,
    });
  }

  const items = Array.from(unique.values()).slice(0, input.limit ?? 8);
  return { items };
}