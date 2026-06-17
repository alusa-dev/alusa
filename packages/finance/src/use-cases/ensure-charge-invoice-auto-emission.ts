import { handleChargeInvoicePaymentEvent } from './handle-charge-invoice-payment-event';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';

const PAID_PROVIDER_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

function normalize(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

function isChargePaidLocally(input: {
  chargeStatus: string | null;
  cobrancaStatus: string | null;
  providerStatus: string | null;
}): boolean {
  if (input.chargeStatus === 'PAID' || input.cobrancaStatus === 'PAGO') return true;
  return Boolean(input.providerStatus && PAID_PROVIDER_STATUSES.has(input.providerStatus));
}

/**
 * Garante emissão automática da NFS-e quando o pagamento já está confirmado localmente
 * e a conta está configurada para `ON_PAYMENT`. Idempotente — não reemite se já existir nota ativa.
 */
export async function ensureChargeInvoiceAutoEmission(input: {
  contaId: string;
  chargeId: string;
}): Promise<void> {
  const prisma = getFiscalPrisma();

  const [settings, invoice, charge] = await Promise.all([
    prisma.contaFiscalSettings.findUnique({
      where: { contaId: input.contaId },
      select: { emissionMode: true },
    }),
    prisma.invoice.findFirst({
      where: { contaId: input.contaId, chargeId: input.chargeId },
      select: { id: true, status: true },
    }),
    prisma.charge.findFirst({
      where: { id: input.chargeId, contaId: input.contaId },
      select: {
        asaasPaymentId: true,
        status: true,
        asaasStatus: true,
        cobranca: { select: { status: true } },
      },
    }),
  ]);

  if (settings?.emissionMode !== 'ON_PAYMENT') return;
  if (invoice && invoice.status !== 'ERROR') return;
  if (!charge?.asaasPaymentId) return;

  const providerStatus = normalize(charge.asaasStatus);
  const cobrancaStatus = normalize(charge.cobranca?.status);
  const chargeStatus = normalize(charge.status);

  if (!isChargePaidLocally({ chargeStatus, cobrancaStatus, providerStatus })) return;

  await handleChargeInvoicePaymentEvent({
    contaId: input.contaId,
    chargeId: input.chargeId,
    asaasPaymentId: charge.asaasPaymentId,
    event: 'PAYMENT_CONFIRMED',
    providerStatus: providerStatus ?? 'CONFIRMED',
  });
}
