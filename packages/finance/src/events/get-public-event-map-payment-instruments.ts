import { prisma } from '@alusa/database';
import { getEventAsaasPaymentProvider } from './event-asaas-payment-provider';
import { loadDecryptedAsaasCredentials } from '../foundation/load-decrypted-asaas-credentials';
import { logEventsFinance } from './events-finance-observability';

/** Loads only the payment instrument the authenticated public order needs. */
export async function getPublicEventMapPaymentInstruments(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken },
    select: { contaId: true, asaasPaymentId: true, paymentMethod: true },
  });
  if (!order?.asaasPaymentId) return { pixQrCode: null, bankSlipInfo: null };

  const credentials = await loadDecryptedAsaasCredentials(order.contaId);
  if (!credentials?.apiKey) return { pixQrCode: null, bankSlipInfo: null };

  if (order.paymentMethod === 'PIX') {
    try {
      const pixQrCode = await getEventAsaasPaymentProvider().getPixQrCode({
        apiKey: credentials.apiKey,
        paymentId: order.asaasPaymentId,
      });
      return { pixQrCode, bankSlipInfo: null };
    } catch (error) {
      logEventsFinance(
        'finance.events.public_event_map.payment_instruments.pix_qr.failed',
        { error },
        'warn',
      );
      return { pixQrCode: null, bankSlipInfo: null };
    }
  }

  if (order.paymentMethod === 'BOLETO') {
    try {
      const bankSlip = await getEventAsaasPaymentProvider().getBankSlipBillingInfo({
        apiKey: credentials.apiKey,
        paymentId: order.asaasPaymentId,
      });
      return {
        pixQrCode: null,
        bankSlipInfo: bankSlip
          ? {
              identificationField: bankSlip.identificationField ?? bankSlip.barCode ?? null,
              barCode: bankSlip.barCode ?? null,
            }
          : null,
      };
    } catch (error) {
      logEventsFinance(
        'finance.events.public_event_map.payment_instruments.bank_slip.failed',
        { error },
        'warn',
      );
      return { pixQrCode: null, bankSlipInfo: null };
    }
  }

  return { pixQrCode: null, bankSlipInfo: null };
}
