import { prisma } from '@alusa/database';

import { parseWithdrawDestination, summarizeWithdrawDestination } from './transfers/recipient-utils';

export interface DeleteTransferRecipientInput {
  contaId: string;
  recipientId: string;
}

export interface DeleteTransferRecipientOutput {
  removedCount: number;
}

export async function deleteTransferRecipient(
  input: DeleteTransferRecipientInput,
): Promise<DeleteTransferRecipientOutput> {
  const rows = await prisma.transferRequest.findMany({
    where: { contaId: input.contaId },
    select: {
      id: true,
      destination: true,
    },
  });

  const updates = rows.flatMap((row) => {
    const destination = parseWithdrawDestination(row.destination);
    if (!destination || destination.type !== 'PIX') return [];

    const summary = summarizeWithdrawDestination(destination);
    if (summary.key !== input.recipientId || destination.saveRecipient === false) return [];

    return prisma.transferRequest.update({
      where: { id: row.id },
      data: {
        destination: {
          ...destination,
          saveRecipient: false,
        } as unknown as object,
      },
      select: { id: true },
    });
  });

  if (updates.length === 0) {
    return { removedCount: 0 };
  }

  await prisma.$transaction(updates);
  return { removedCount: updates.length };
}