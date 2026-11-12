import { NextResponse } from 'next/server';
import { resolveTenantScopeForJob } from '@/src/server/jobs/job-observability';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';

/** Compatibility endpoint for scheduled jobs left in external environments. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScopeForJob('expire-contract-links', () => resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
  }));
  if (!scope.ok) return scope.response;

  return NextResponse.json({ success: true, processedAccounts: 0, updatedContracts: 0, results: [], errors: [], disabled: true });
}

export async function GET() {
  return NextResponse.json({
    job: 'expire-contract-links',
    description: 'Desativado: links de assinatura de contratos não expiram.',
    method: 'POST',
    enabled: false,
  });
}
