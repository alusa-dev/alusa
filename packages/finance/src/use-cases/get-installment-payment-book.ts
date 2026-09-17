import {
  getAsaasBaseUrlForApiKeyOrThrow,
  getInstallmentPaymentBook,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

/**
 * Consulta o documento de parcelamento do tenant no provedor.
 *
 * A operação é documental/read-only: não altera estado financeiro local nem
 * substitui o webhook como fonte de verdade. O URL só é devolvido quando
 * pertence ao mesmo host Asaas resolvido para a credencial do tenant.
 */
export async function getTenantInstallmentPaymentBook(
  contaId: string,
  installmentId: string,
): Promise<string | null> {
  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials?.apiKey) return null;

  const result = await getInstallmentPaymentBook({
    apiKey: credentials.apiKey,
    installmentId,
  });
  const rawPdfUrl = typeof result.pdfUrl === 'string' ? result.pdfUrl.trim() : '';
  if (!rawPdfUrl) return null;

  const baseUrl = new URL(getAsaasBaseUrlForApiKeyOrThrow(credentials.apiKey));
  const pdfUrl = new URL(rawPdfUrl, baseUrl);
  if (pdfUrl.protocol !== 'https:' || pdfUrl.origin !== baseUrl.origin) return null;
  return pdfUrl.toString();
}
