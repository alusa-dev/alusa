import { prisma } from '@alusa/database';
import { getEventAsaasPaymentProvider } from '@alusa/lib/events/event-asaas-payment-provider';
import { loadDecryptedAsaasCredentials } from '@alusa/lib/services/integracoes/asaas-credentials-service';

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
      console.warn('[event-map] Falha ao obter QR Code Pix para pedido público:', { orderId, error });
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
      console.warn('[event-map] Falha ao obter código do boleto para pedido público:', { orderId, error });
      return { pixQrCode: null, bankSlipInfo: null };
    }
  }

  return { pixQrCode: null, bankSlipInfo: null };
}
