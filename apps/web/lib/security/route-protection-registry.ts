export type RouteProtection =
  | 'PUBLIC'
  | 'AUTH_USER'
  | 'TENANT_ADMIN'
  | 'TENANT_FINANCE'
  | 'CRON_SECRET'
  | 'WEBHOOK_TOKEN'
  | 'MOBILE_ACCESS_TOKEN';

type RouteProtectionRule = {
  prefix: string;
  protection: RouteProtection;
  exact?: boolean;
};

export const routeProtectionRegistry = [
  { prefix: '/api/auth/', protection: 'PUBLIC' },
  { prefix: '/api/mobile/auth/', protection: 'PUBLIC' },
  { prefix: '/api/mobile/', protection: 'MOBILE_ACCESS_TOKEN' },
  { prefix: '/api/admin/', protection: 'TENANT_ADMIN' },
  { prefix: '/api/financeiro/', protection: 'TENANT_FINANCE' },
  { prefix: '/api/finance/', protection: 'TENANT_FINANCE' },
  // Cobranças também atendem fluxos de matrícula/rematrícula em que RECEPCAO
  // pode gerar segunda via. O tenant é obrigatório aqui; a autorização fina
  // por operação continua no Route Handler/use case, sem bloquear esse
  // contrato legítimo por uma regra global de namespace.
  { prefix: '/api/cobrancas', protection: 'AUTH_USER', exact: true },
  { prefix: '/api/cobrancas/', protection: 'AUTH_USER' },
  { prefix: '/api/public/', protection: 'PUBLIC' },
  { prefix: '/api/users/register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/first-register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/accept', protection: 'PUBLIC', exact: true },
  { prefix: '/api/assets/asaas-seal', protection: 'PUBLIC', exact: true },
  { prefix: '/api/health', protection: 'PUBLIC', exact: true },
  { prefix: '/api/health/', protection: 'PUBLIC' },
  { prefix: '/api/privacy/cookie-consent', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/requests', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/export', protection: 'AUTH_USER' },
  { prefix: '/api/webhooks/', protection: 'WEBHOOK_TOKEN' },
  { prefix: '/api/jobs/', protection: 'CRON_SECRET' },
  { prefix: '/api/observability/web-vitals', protection: 'PUBLIC', exact: true },
  { prefix: '/api/internal/health', protection: 'CRON_SECRET', exact: true },
  { prefix: '/api/internal/rls-health', protection: 'CRON_SECRET', exact: true },
] as const satisfies readonly RouteProtectionRule[];

function matchesRule(pathname: string, rule: RouteProtectionRule): boolean {
  return rule.exact ? pathname === rule.prefix : pathname.startsWith(rule.prefix);
}

export function resolveRouteProtection(pathname: string): RouteProtection {
  const match = routeProtectionRegistry.find((rule) => matchesRule(pathname, rule));
  return match?.protection ?? 'AUTH_USER';
}

export function isRegisteredPublicApiPath(pathname: string): boolean {
  const protection = resolveRouteProtection(pathname);
  return protection === 'PUBLIC' || protection === 'WEBHOOK_TOKEN' || protection === 'CRON_SECRET';
}

export function hasCronSecret(req: Request): boolean {
  const canonicalToken = process.env.CRON_SECRET?.trim();
  const legacyToken = process.env.CRON_SECRET_TOKEN?.trim();
  const cronToken = req.headers.get('x-cron-token');
  const authorization = req.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;

  // Vercel sends Bearer CRON_SECRET. Keep the custom header compatible with
  // legacy callers, while never allowing a stale legacy secret to shadow it.
  if (bearerToken) return canonicalToken ? bearerToken === canonicalToken : bearerToken === legacyToken;
  return Boolean((canonicalToken && cronToken === canonicalToken) || (legacyToken && cronToken === legacyToken));
}
