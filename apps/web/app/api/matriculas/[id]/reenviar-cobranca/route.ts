import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { matriculaRouteParamsDTOSchema } from '@/features/enrollments/dtos';
import {
  parseResendEnrollmentChargeResponse,
  resendEnrollmentCharge,
} from '@/src/server/enrollments/resend-enrollment-charge.service';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const { id: matriculaId } = matriculaRouteParamsDTOSchema.parse(await params);
    const result = await resendEnrollmentCharge({
      matriculaId,
      contaId: auth.contaId,
      userId: auth.userId,
    });
    if (result.kind === 'FAILURE') return NextResponse.json(result.body, { status: result.status });

    return NextResponse.json(parseResendEnrollmentChargeResponse(result));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/matriculas/[id]/reenviar-cobranca',
      method: 'POST',
      requestId: getRequestId(_req),
      error,
    });
    return NextResponse.json(
      { error: 'Erro interno ao reenviar cobrança', details: undefined },
      { status: 500 },
    );
  }
}
