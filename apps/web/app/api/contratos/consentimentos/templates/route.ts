import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { listContratoConsentimentoTemplatesResultDTOSchema } from '@/features/contracts/dtos';
import { listActiveConsentimentoTemplates } from '@/src/server/contracts/consentimento-template.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request = new Request('http://localhost/api/contratos/consentimentos/templates'),
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });

  try {
    const templates = await listActiveConsentimentoTemplates(user.contaId);

    return NextResponse.json(listContratoConsentimentoTemplatesResultDTOSchema.parse(templates));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/contratos/consentimentos/templates',
      method: 'GET',
      requestId: getRequestId(request),
      error,
    });
    return NextResponse.json(
      { error: { message: 'Erro ao listar templates de consentimento' } },
      { status: 500 },
    );
  }
}
