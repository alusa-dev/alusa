import type { UniversalQrResolution } from '../types/universal-qr';

const TICKET_PREFIX = /^TICKET[_-]/i;
const PAYMENT_BARCODE_LENGTHS = new Set([44, 46, 47, 48]);
const GENERIC_PATH_SEGMENTS = new Set(['qr', 'qrcode', 'qr-code', 'ticket', 'tickets', 'ingresso', 'ingressos']);

export function resolveUniversalQr(value: string): UniversalQrResolution {
  const rawValue = value.trim();
  if (!rawValue) return unknownResolution();

  const parsedUrl = parseUrl(rawValue);
  const ticketCode = getTicketCode(parsedUrl, rawValue);
  if (ticketCode) {
    return {
      kind: 'EVENT_TICKET',
      title: 'Ingresso identificado',
      message: 'Confira os dados do evento antes de registrar a entrada.',
      displayValue: maskCode(ticketCode),
      target: { type: 'EVENT_TICKET', ticketCode },
    };
  }

  if (isPixPayload(rawValue)) {
    return {
      kind: 'PIX',
      title: 'Pix identificado',
      message: 'Este código contém um pagamento Pix. Confira o destinatário e o valor no aplicativo do seu banco antes de confirmar.',
    };
  }

  const paymentBarcode = normalizePaymentBarcode(rawValue);
  if (paymentBarcode && PAYMENT_BARCODE_LENGTHS.has(paymentBarcode.length)) {
    return {
      kind: 'BOLETO',
      title: 'Código de pagamento identificado',
      message: 'Este código pode ser de um boleto ou outra cobrança bancária. Confira os dados antes de pagar.',
      displayValue: maskCode(paymentBarcode),
    };
  }

  if (parsedUrl?.protocol === 'alusa:') {
    const chargeId = getChargeId(parsedUrl);
    return {
      kind: 'ALUSA_LINK',
      title: 'Fluxo da Alusa identificado',
      message: chargeId
        ? 'Encontramos uma cobrança da Alusa. Abra os detalhes para continuar.'
        : 'Encontramos um fluxo interno da Alusa. Abra-o somente se você reconhecer esta operação.',
      target: chargeId ? { type: 'CHARGE', chargeId } : undefined,
    };
  }

  return unknownResolution();
}

/**
 * Códigos legados de ingresso podem não ter o prefixo TICKET_. O leitor tenta
 * validá-los no servidor apenas quando o conteúdo não parece um link externo,
 * Pix ou código de pagamento.
 */
export function isPossibleEventTicketCode(value: string) {
  const rawValue = value.trim();
  if (rawValue.length < 4 || rawValue.length > 128) return false;
  if (parseUrl(rawValue)) return false;
  if (isPixPayload(rawValue)) return false;
  const barcode = normalizePaymentBarcode(rawValue);
  return !(barcode && PAYMENT_BARCODE_LENGTHS.has(barcode.length));
}

function getTicketCode(url: URL | null, rawValue: string) {
  if (!url) return TICKET_PREFIX.test(rawValue) ? rawValue : null;

  const path = url.pathname.toLowerCase();
  const ticketPath = `${url.hostname} ${path}`;
  const explicitTicketCode = url.searchParams.get('ticketCode') ?? url.searchParams.get('ticket');
  const pathCode = ticketPath.includes('ticket') || ticketPath.includes('ingresso')
    ? url.searchParams.get('code')
    : null;
  const candidate = explicitTicketCode ?? pathCode;

  if (candidate?.trim()) return candidate.trim();
  return TICKET_PREFIX.test(rawValue) ? rawValue : null;
}

function getChargeId(url: URL) {
  const queryChargeId = url.searchParams.get('chargeId') ?? url.searchParams.get('cobrancaId');
  if (queryChargeId?.trim()) return queryChargeId.trim();

  const segments = url.pathname.split('/').filter(Boolean);
  const normalizedHost = url.hostname.toLowerCase();
  if (normalizedHost === 'billing' || normalizedHost === 'cobranca' || normalizedHost === 'cobrancas') {
    const chargeIndex = segments.findIndex((segment) => ['charge', 'cobranca', 'cobrancas'].includes(segment.toLowerCase()));
    const candidate = chargeIndex >= 0 ? segments[chargeIndex + 1] : undefined;
    return candidate && !GENERIC_PATH_SEGMENTS.has(candidate.toLowerCase()) ? candidate : null;
  }

  return null;
}

function isPixPayload(value: string) {
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return normalized.startsWith('000201') && normalized.includes('br.gov.bcb.pix');
}

function normalizePaymentBarcode(value: string) {
  const normalized = value.replace(/[.\s-]/g, '');
  return /^\d+$/.test(normalized) ? normalized : null;
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function maskCode(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function unknownResolution(): UniversalQrResolution {
  return {
    kind: 'UNKNOWN',
    title: 'QR Code não reconhecido',
    message: 'Este código não corresponde a um fluxo compatível da Alusa.',
  };
}
