/**
 * Whitelist de IPs de origem dos webhooks do Asaas.
 * 
 * IPs documentados oficialmente pela Asaas (sandbox + produção).
 * @see https://docs.asaas.com/docs/webhook
 */

const ASAAS_WEBHOOK_IPS = new Set([
  '52.67.12.206',
  '18.230.8.159',
  '54.94.136.112',
  '54.94.183.101',
]);

/**
 * Em dev, permitir qualquer IP (webhooks via tunneling, etc.)
 */
function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * Extrai o IP do cliente de headers comuns de proxy/CDN.
 */
export function extractClientIp(headers: Headers): string | null {
  // CF-Connecting-IP (Cloudflare)
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // X-Forwarded-For (primeiro IP = cliente real)
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  // X-Real-IP
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return null;
}

/**
 * Verifica se o IP está na whitelist do Asaas.
 * Em dev/test, sempre retorna true.
 */
export function isAsaasWebhookIpAllowed(ip: string | null): boolean {
  if (isDevMode()) return true;

  // Se ASAAS_WEBHOOK_IP_CHECK=false, desabilitar (útil para staging com tunnel)
  if (process.env.ASAAS_WEBHOOK_IP_CHECK === 'false') return true;

  if (!ip) return false;
  return ASAAS_WEBHOOK_IPS.has(ip);
}

/**
 * IPs autorizados (para diagnóstico/logging).
 */
export function getAsaasWebhookIps(): string[] {
  return [...ASAAS_WEBHOOK_IPS];
}
