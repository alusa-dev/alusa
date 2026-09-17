import { NextResponse } from 'next/server';

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export function isTestRouteEnabled(): boolean {
  const explicitlyIsolatedProductionE2E =
    process.env.NODE_ENV === 'production' &&
    process.env.E2E_SERVER_MODE === 'production' &&
    process.env.PLAYWRIGHT_TEST === 'true' &&
    process.env.TEST_ROUTES_ENABLED === 'true';

  // Production-like E2E runs the real production server and therefore needs
  // its deterministic fixture routes. The four explicit flags above are
  // server-side test configuration; real production never enables them.
  return (
    (!isProductionRuntime() || explicitlyIsolatedProductionE2E) &&
    process.env.TEST_ROUTES_ENABLED === 'true'
  );
}

export function isDiagnosticsRouteEnabled(): boolean {
  return (
    !isProductionRuntime() &&
    process.env.NODE_ENV === 'development' &&
    process.env.DEBUG_DIAGNOSTICS_ENABLED === 'true'
  );
}

export function notFoundJson() {
  return NextResponse.json(
    { error: 'Not Found' },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}
