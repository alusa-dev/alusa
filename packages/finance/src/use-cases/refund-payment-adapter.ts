import { createHash, createHmac } from 'node:crypto';
import { refundPayment as asaasRefundPayment, type AsaasPayment } from '@alusa/asaas';
import { AsaasHttpError } from '@alusa/asaas';

export interface FinanceRefundPaymentInput {
  apiKey: string;
  paymentId: string;
  value?: number;
  description?: string;
  splitRefunds?: Array<{ id: string; value: number }>;
  idempotencyKey?: string;
}

function gatewayConfigError(code: string, message: string): AsaasHttpError {
  const safeBody = { error: code };
  return new AsaasHttpError(message, 400, safeBody, safeBody);
}

/** Server-side Alusa transport adapter; disabled/unconfigured means direct Asaas HTTP. */
export async function refundPaymentWithGateway(input: FinanceRefundPaymentInput): Promise<AsaasPayment> {
  if (typeof window !== 'undefined') throw new Error('refundPaymentWithGateway só pode ser chamado no servidor.');
  if (process.env.ASAAS_REFUND_GATEWAY_ENABLED !== 'true') {
    return asaasRefundPayment(input);
  }

  const gatewayUrl = process.env.ASAAS_REFUND_GATEWAY_URL?.trim();
  const gatewaySecret = process.env.ASAAS_REFUND_GATEWAY_SECRET?.trim();
  if (!gatewayUrl || !gatewaySecret) throw gatewayConfigError('REFUND_GATEWAY_CONFIG_MISSING', 'Gateway de estorno habilitado sem URL ou segredo configurado.');
  if (Buffer.byteLength(gatewaySecret, 'utf8') < 32) throw gatewayConfigError('REFUND_GATEWAY_SECRET_INVALID', 'O segredo do gateway de estorno deve ter pelo menos 32 bytes.');
  if (!input.idempotencyKey?.trim()) throw gatewayConfigError('REFUND_GATEWAY_IDEMPOTENCY_KEY_MISSING', 'Gateway de estorno habilitado sem chave de idempotência do comando.');
  if (!input.apiKey.startsWith('$aact_hmlg_')) throw gatewayConfigError('REFUND_GATEWAY_SANDBOX_ONLY', 'O gateway de estorno aceita somente credenciais Asaas sandbox.');
  let url: URL;
  try { url = new URL(gatewayUrl); } catch {
    throw gatewayConfigError('REFUND_GATEWAY_URL_INVALID', 'ASAAS_REFUND_GATEWAY_URL inválida.');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw gatewayConfigError('REFUND_GATEWAY_URL_INVALID', 'ASAAS_REFUND_GATEWAY_URL inválida.');
  }
  const path = `/v1/payments/${encodeURIComponent(input.paymentId)}/refund`;
  const body = JSON.stringify({ apiKey: input.apiKey, value: input.value, description: input.description, splitRefunds: input.splitRefunds });
  const timestamp = String(Date.now());
  const digest = createHash('sha256').update(input.idempotencyKey.trim()).digest('hex').slice(0, 32);
  const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const signature = createHmac('sha256', gatewaySecret).update(`POST.${path}.${timestamp}.${requestId}.${body}`).digest('hex');
  const response = await fetch(`${url.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-alusa-timestamp': timestamp, 'x-alusa-request-id': requestId, 'x-alusa-signature': signature },
    body,
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  if (!response.ok) {
    const safeBody = { error: `REFUND_GATEWAY_HTTP_${response.status}` };
    throw new AsaasHttpError(`Gateway de estorno recusou a solicitação (HTTP ${response.status}).`, response.status, safeBody, safeBody);
  }
  return await response.json() as AsaasPayment;
}
