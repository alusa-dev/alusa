import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { assertCanManagePlatformBilling, resolvePlatformBillingActor } from '@/src/server/platform-billing/platform-billing-server';
import { acceptInvitationCondition } from '@/src/server/platform-billing/accept-invitation-condition';

const schema = z.object({ accepted: z.literal(true), version: z.number().int().positive(), selectedStudentCount: z.number().int().min(1).max(100_000) });

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'CONDITION_ACCEPTANCE_REQUIRED' }, { status: 400 });

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    const result = await acceptInvitationCondition({ tx, contaId, userId, version: parsed.data.version, selectedStudentCount: parsed.data.selectedStudentCount });
    if (result.kind === 'NOT_FOUND') return NextResponse.json({ error: 'INVITATION_CONDITION_NOT_FOUND' }, { status: 404 });
    if (result.kind === 'VERSION_STALE') return NextResponse.json({ error: 'INVITATION_CONDITION_VERSION_STALE', currentVersion: result.currentVersion }, { status: 409 });
    if (result.kind === 'ESTIMATE_MISMATCH') return NextResponse.json({ error: 'ONBOARDING_ESTIMATE_MISMATCH', message: 'Salve novamente a estimativa de alunos antes de aceitar a condição.' }, { status: 409 });
    if (result.kind === 'CUSTOM_CONDITION_COUNT_LOCKED') return NextResponse.json({ error: 'CUSTOM_CONDITION_COUNT_LOCKED' }, { status: 409 });
    return NextResponse.json({ accepted: true, alreadyAccepted: result.alreadyAccepted, version: result.version, selectedStudentCount: result.selectedStudentCount, selectedPlanCode: result.selectedPlanCode, selectedMonthlyAmountCents: result.selectedMonthlyAmountCents }, { headers: { 'cache-control': 'no-store' } });
  });
}
