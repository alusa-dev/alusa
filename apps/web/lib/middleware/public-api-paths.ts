/**
 * API routes that must never pass through page session gates (redirect/HTML).
 * Aligns with Next.js guidance to exclude /api from auth redirect middleware.
 */

const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/webhooks/',
  '/api/jobs/',
  '/api/public/',
  '/api/users/register',
  '/api/users/first-register',
  '/api/users/accept',
  '/api/health/',
  '/api/observability/',
  '/api/internal/rls-health',
  '/api/developer/auth/',
  '/api/global-admin/auth/',
] as const;

export function isPublicApiPath(pathname: string): boolean {
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true') {
    return pathname.startsWith('/api/test/') || pathname.startsWith('/api/dev/');
  }

  return false;
}
