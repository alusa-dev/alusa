import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';
import { PausaBusinessError, regularizarPausaVencida } from '@/src/server/enrollments/enrollment-pause.service';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';

const schema = z.object({ motivo: z.string().trim().min(8).max(1000) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.role !== 'ADMIN' || auth.authContext === 'PORTAL') {
    return NextResponse.json({ error: { code: 'SEM_PERMISSAO' } }, { status: 403 });
  }
  try {
    await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ENROLLMENT_WRITE' });
  } catch (error) {
    const blocked = platformBillingAccessResponse(error);
    if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/matriculas/[id]/regularizar-pausa',
      method: 'POST',
      requestId: getRequestId(request),
      error,
    });
    return NextResponse.json({ error: { code: 'ERRO_INTERNO' } }, { status: 500 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'DADOS_INVALIDOS' } }, { status: 422 });
  const { id } = await params;

  try {
    const operation = await runWithTenant(auth.contaId, (tx) => regularizarPausaVencida({
      tx,
      contaId: auth.contaId,
      matriculaId: id,
      actorId: auth.userId,
      motivo: parsed.data.motivo,
    }));
    return NextResponse.json({ data: operation });
  } catch (error) {
    if (error instanceof PausaBusinessError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.statusCode });
    }
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/matriculas/[id]/regularizar-pausa',
      method: 'POST',
      requestId: getRequestId(request),
      error,
    });
    return NextResponse.json({ error: { code: 'ERRO_INTERNO' } }, { status: 500 });
  }
}
