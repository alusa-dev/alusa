export type RouteProtection =
  | 'PUBLIC'
  | 'AUTH_USER'
  | 'TENANT_ADMIN'
  | 'TENANT_FINANCE'
  | 'CRON_SECRET'
  | 'WEBHOOK_TOKEN'
  | 'GLOBAL_ADMIN'
  | 'DEVELOPER_MFA';

type RouteProtectionRule = {
  prefix: string;
  protection: RouteProtection;
  exact?: boolean;
};

export const routeProtectionRegistry = [
  { prefix: '/api/auth/', protection: 'PUBLIC' },
  { prefix: '/api/public/', protection: 'PUBLIC' },
  { prefix: '/api/users/register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/first-register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/accept', protection: 'PUBLIC', exact: true },
  { prefix: '/api/health/', protection: 'PUBLIC' },
  { prefix: '/api/privacy/cookie-consent', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/requests', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/export', protection: 'AUTH_USER' },
  { prefix: '/api/webhooks/', protection: 'WEBHOOK_TOKEN' },
  { prefix: '/api/jobs/', protection: 'CRON_SECRET' },
  { prefix: '/api/observability/web-vitals', protection: 'PUBLIC', exact: true },
  { prefix: '/api/internal/health', protection: 'CRON_SECRET', exact: true },
  { prefix: '/api/internal/rls-health', protection: 'CRON_SECRET', exact: true },
  { prefix: '/api/developer/auth/', protection: 'DEVELOPER_MFA' },
  { prefix: '/api/developer/', protection: 'GLOBAL_ADMIN' },
  { prefix: '/api/global-admin/auth/', protection: 'DEVELOPER_MFA' },
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
  return protection === 'PUBLIC' || protection === 'WEBHOOK_TOKEN' || protection === 'CRON_SECRET' || protection === 'DEVELOPER_MFA';
}

export function hasCronSecret(req: Request): boolean {
  const configuredToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  if (!configuredToken) return false;

  const cronToken = req.headers.get('x-cron-token');
  const authorization = req.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  return cronToken === configuredToken || bearerToken === configuredToken;
}
