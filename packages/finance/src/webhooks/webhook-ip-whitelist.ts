/**
 * Whitelist de IPs de origem dos webhooks do Asaas.
 * 
 * IPs documentados oficialmente pela Asaas (sandbox + produção).
 * @see https://docs.asaas.com/docs/webhook
 */

const ASAAS_WEBHOOK_IPS = new Set([
  '52.67.12.206',
  '52.67.211.226',
  '18.230.8.159',
  '54.94.136.112',
  '54.94.135.45',
  '54.94.183.101',
]);

/**
 * Em dev, permitir qualquer IP (webhooks via tunneling, etc.)
 */
function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

function parseIpList(value: string | null | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Extrai IPs candidatos de headers comuns para diagnóstico/compatibilidade. */
export function extractClientIps(headers: Headers): string[] {
  const ips = [
    ...parseIpList(headers.get('cf-connecting-ip')),
    ...parseIpList(headers.get('x-real-ip')),
    ...parseIpList(headers.get('x-forwarded-for')),
  ];
  return [...new Set(ips)];
}

/** Retorna o primeiro candidato para compatibilidade/diagnóstico; não autoriza IP. */
export function extractClientIp(headers: Headers): string | null {
  return extractClientIps(headers)[0] ?? null;
}

/**
 * Verifica se o IP está na whitelist do Asaas.
 * Em dev/test, sempre retorna true.
 */
export function isAsaasWebhookIpAllowed(ip: string | string[] | null): boolean {
  if (isDevMode()) return true;

  // Se ASAAS_WEBHOOK_IP_CHECK=false, desabilitar (útil para staging com tunnel)
  if (process.env.ASAAS_WEBHOOK_IP_CHECK === 'false') return true;

  if (!ip) return false;
  const candidates = Array.isArray(ip) ? ip : [ip];
  return candidates.some((candidate) => ASAAS_WEBHOOK_IPS.has(candidate));
}

/**
 * Modo estrito bloqueia por IP antes do processamento.
 * Por padrão, a validação de IP é diagnóstica para não pausar filas caso
 * Asaas sandbox use IP adicional ou o proxy altere a cadeia X-Forwarded-For.
 */
export function shouldBlockAsaasWebhookByIp(ip: string | string[] | null): boolean {
  return shouldBlockAsaasWebhookByIpForTenant(ip, null);
}

/**
 * Exceção temporária para Conta Sandbox explicitamente configurada pelo
 * operador. Só deve ser chamada após autenticar o token e resolver contaId.
 * O default vazio mantém strict IP checking para todos os tenants.
 */
function isAsaasSandboxWebhookIpExceptionTenant(contaId: string | null | undefined): boolean {
  if (!contaId) return false;
  const configuredTenantIds = parseIpList(process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS);
  return configuredTenantIds.includes(contaId);
}

export function shouldBlockAsaasWebhookByIpForTenant(
  ip: string | string[] | null,
  authenticatedContaId: string | null,
): boolean {
  if (process.env.ASAAS_WEBHOOK_IP_CHECK !== 'strict') return false;
  if (isAsaasSandboxWebhookIpExceptionTenant(authenticatedContaId)) return false;
  return !isAsaasWebhookIpAllowed(ip);
}

/**
 * IPs autorizados (para diagnóstico/logging).
 */
export function getAsaasWebhookIps(): string[] {
  return [...ASAAS_WEBHOOK_IPS];
}
