import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { resolvePlatformBillingActor, resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

const bodySchema = z.object({ issueId: z.string().min(1).max(128) }).strict();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });

  const environment = resolvePlatformBillingEnvironment();
  return withTenantSession(async ({ contaId, userId, tx }) => {
    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    if (!actor.canManagePlatformBilling) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

    const result = await tx.platformBillingIssue.updateMany({
      where: {
        id: parsed.data.issueId,
        contaId,
        environment,
        code: 'MONTHLY_CLOSE_INCONCLUSIVE',
        status: 'OPEN',
        ignoredAt: null,
      },
      data: { ignoredAt: new Date() },
    });

    return NextResponse.json({ acknowledged: result.count === 1 });
  });
}
