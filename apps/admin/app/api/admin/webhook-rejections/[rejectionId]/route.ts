import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { getSupportWebhookRejectionDetail } from '@/features/support/queries/support-account';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ rejectionId: string }> },
) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_VIEWER', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'admin-webhook-rejection-detail',
  });
  if (!auth.ok) return auth.response;

  const { rejectionId } = await params;
  const rejection = await getSupportWebhookRejectionDetail(rejectionId);
  if (!rejection) {
    return NextResponse.json(
      { success: false, error: 'Rejeição de webhook não encontrada.' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { success: true, data: rejection },
    { headers: { 'cache-control': 'no-store' } },
  );
}
