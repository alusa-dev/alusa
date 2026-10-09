import { prisma } from '@alusa/database';
import { getEventAsaasPaymentProvider } from './event-asaas-payment-provider';
import { loadDecryptedAsaasCredentials } from '../foundation/load-decrypted-asaas-credentials';

const OPEN_CHARGE_STATUSES = ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'] as const;

export async function cancelOpenEventParticipantCharges(input: {
  contaId: string;
  chargeIds: string[];
}): Promise<void> {
  if (input.chargeIds.length === 0) return;

  const charges = await prisma.charge.findMany({
    where: {
      contaId: input.contaId,
      id: { in: input.chargeIds },
      status: { in: [...OPEN_CHARGE_STATUSES] },
    },
    select: { asaasPaymentId: true },
  });
  const paymentIds = [...new Set(charges.map((charge) => charge.asaasPaymentId).filter((id): id is string => Boolean(id)))];
  if (paymentIds.length === 0) return;

  const credentials = await loadDecryptedAsaasCredentials(input.contaId);
  if (!credentials?.apiKey) return;

  for (const paymentId of paymentIds) {
    await getEventAsaasPaymentProvider().deletePayment({ apiKey: credentials.apiKey, paymentId });
  }
}
