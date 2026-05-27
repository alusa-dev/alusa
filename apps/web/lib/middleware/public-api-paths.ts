import { isTestRouteEnabled } from '@/lib/security/runtime-guards';
import { isRegisteredPublicApiPath } from '@/lib/security/route-protection-registry';

/**
 * API routes that must never pass through page session gates (redirect/HTML).
 * Aligns with Next.js guidance to exclude /api from auth redirect middleware.
 */

export function isPublicApiPath(pathname: string): boolean {
  if (isRegisteredPublicApiPath(pathname)) {
    return true;
  }

  if (isTestRouteEnabled()) {
    return pathname.startsWith('/api/test/') || pathname.startsWith('/api/dev/');
  }

  return false;
}
