import type { Prisma } from '@prisma/client';
import { encryptSecret } from '@alusa/database';

export async function enqueueContractEmailNotification(tx: Prisma.TransactionClient, input: {
  contaId: string;
  contratoId: string;
  matriculaId: string;
  token: string;
  tokenHash: string;
  recipientEmail: string;
  recipientName: string;
  deliveryKey: string;
}) {
  return tx.contractEmailNotification.upsert({
    where: { uq_contract_email_notification_delivery: { contaId: input.contaId, deliveryKey: input.deliveryKey } },
    update: {},
    create: {
      contaId: input.contaId,
      contratoId: input.contratoId,
      matriculaId: input.matriculaId,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      tokenCriptografado: encryptSecret(input.token),
      tokenPublicoHash: input.tokenHash,
      deliveryKey: input.deliveryKey,
    },
  });
}
