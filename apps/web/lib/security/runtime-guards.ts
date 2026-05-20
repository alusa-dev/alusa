import { NextResponse } from 'next/server';

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export function isTestRouteEnabled(): boolean {
  return !isProductionRuntime() && process.env.TEST_ROUTES_ENABLED === 'true';
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
