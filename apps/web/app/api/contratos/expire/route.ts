import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { expireContratosResultDTOSchema } from '@/features/contracts/dtos';
import { expireContractSignatureLinks } from '@/src/server/contracts/expire-contract-signature-links.service';

export async function POST(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const result = await expireContractSignatureLinks({ contaId: user.contaId, limit: 500 });
    return NextResponse.json(expireContratosResultDTOSchema.parse({ updated: result.atualizados }));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/contratos/expire',
      method: 'POST',
      requestId: getRequestId(_request),
      error,
    });
    return NextResponse.json({ error: { message: 'Erro ao expirar contratos' } }, { status: 500 });
  }
}
