import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { privacyRequestRouteParamsDTOSchema } from '@/features/privacy/dtos';
import { getPrivacyRequest } from '@/src/server/privacy/privacy-request.service';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }

  const parsedParams = privacyRequestRouteParamsDTOSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Solicitacao invalida.' }, { status: 400 });
  }
  const { requestId } = parsedParams.data;
  const request = await getPrivacyRequest({
    requestId,
    contaId: auth.contaId,
    userId: auth.userId,
  });

  if (!request) {
    return NextResponse.json({ error: 'Solicitacao nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({
    ...request,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  });
}
