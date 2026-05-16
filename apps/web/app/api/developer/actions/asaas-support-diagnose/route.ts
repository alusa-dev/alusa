import { NextResponse } from 'next/server';

import { supportAsaasDiagnoseSchema } from '@/features/support/actions/schemas';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { diagnoseAsaasSupportRepair } from '@alusa/finance';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-asaas-support-diagnose',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = supportAsaasDiagnoseSchema.parse(await req.json());
    const diagnosis = await diagnoseAsaasSupportRepair(body.contaId);
    return NextResponse.json({ success: true, data: diagnosis }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao diagnosticar integração Asaas' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
