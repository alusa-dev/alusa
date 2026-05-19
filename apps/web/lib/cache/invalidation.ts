import { buildTenantCacheKey, invalidateTenantCache } from './tenant-cache';
import { getTenantCacheAdapter } from './server-cache';

type TenantCacheArea = 'dashboard' | 'finance' | 'charges' | 'support' | 'agenda' | 'inventory' | 'enrollment';

function keysForArea(contaId: string, area: TenantCacheArea) {
  switch (area) {
    case 'dashboard':
      return [
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'metrics', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'finance-kpis', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'summary-cards', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'lesson-summary', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'recent-activity', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'birthdays', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'dashboard', resource: 'experimental-classes', version: 1 }),
      ];
    case 'finance':
      return [
        buildTenantCacheKey({ contaId, area: 'finance', resource: 'account-summary', version: 1 }),
        buildTenantCacheKey({ contaId, area: 'finance', resource: 'anticipation-configuration', version: 1 }),
      ];
    case 'charges':
      return [
        buildTenantCacheKey({ contaId, area: 'charges', resource: 'standalone', version: 1, filterHash: 'default' }),
        buildTenantCacheKey({ contaId, area: 'charges', resource: 'operational-list', version: 1, filterHash: 'default' }),
      ];
    case 'support':
      return [
        buildTenantCacheKey({ contaId, area: 'support', resource: 'account-overview', version: 1 }),
      ];
    default:
      return [];
  }
}

export async function invalidateTenantCacheAreas(
  contaId: string,
  reason: string,
  areas: TenantCacheArea[],
) {
  const keys = Array.from(new Set(areas.flatMap((area) => keysForArea(contaId, area))));
  await invalidateTenantCache(getTenantCacheAdapter(), keys, { contaId, reason, areas });
}

export function invalidateDashboardCache(contaId: string, reason = 'dashboard-update') {
  return invalidateTenantCacheAreas(contaId, reason, ['dashboard']);
}

export function invalidateFinanceCache(contaId: string, reason = 'finance-update') {
  return invalidateTenantCacheAreas(contaId, reason, ['finance', 'dashboard']);
}

export function invalidateChargesCache(contaId: string, reason = 'charges-update') {
  return invalidateTenantCacheAreas(contaId, reason, ['charges', 'finance', 'dashboard']);
}

export function invalidateSupportCache(contaId: string, reason = 'support-update') {
  return invalidateTenantCacheAreas(contaId, reason, ['support']);
}
