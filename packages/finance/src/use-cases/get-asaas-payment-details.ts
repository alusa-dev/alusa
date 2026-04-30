import {
  getBillingInfo,
  getPayment,
  getPixQrCode,
  type AsaasPayment,
  type BillingInfoResponse,
  type PixQrCodeResponse,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

export type GetAsaasPaymentDetailsResult = {
  payment: AsaasPayment;
  pixQrCode: PixQrCodeResponse | null;
  billingInfo: BillingInfoResponse | null;
};

export async function getAsaasPaymentDetails(params: {
  contaId: string;
  paymentId: string;
  includePixQrCode?: boolean;
}): Promise<GetAsaasPaymentDetailsResult> {
  const creds = await loadAsaasCredentials(params.contaId);
  if (!creds?.apiKey) {
    throw new Error('Credenciais do Asaas não configuradas');
  }

  const payment = await getPayment({ apiKey: creds.apiKey, paymentId: params.paymentId });

  let billingInfo: BillingInfoResponse | null = null;
  if (payment.billingType === 'PIX' || payment.billingType === 'BOLETO') {
    try {
      billingInfo = await getBillingInfo({ apiKey: creds.apiKey, paymentId: params.paymentId });
    } catch {
      billingInfo = null;
    }
  }

  let pixQrCode: PixQrCodeResponse | null = null;
  if (params.includePixQrCode && payment.billingType === 'PIX') {
    if (billingInfo?.pix?.encodedImage && billingInfo.pix.payload && billingInfo.pix.expirationDate) {
      pixQrCode = {
        encodedImage: billingInfo.pix.encodedImage,
        payload: billingInfo.pix.payload,
        expirationDate: billingInfo.pix.expirationDate,
      };
    } else {
      try {
        pixQrCode = await getPixQrCode({ apiKey: creds.apiKey, paymentId: params.paymentId });
      } catch {
        pixQrCode = null;
      }
    }
  }

  return { payment, pixQrCode, billingInfo };
}
