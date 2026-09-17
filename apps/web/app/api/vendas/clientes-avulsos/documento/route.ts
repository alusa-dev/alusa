import { NextRequest, NextResponse } from 'next/server';

import { vendasClienteDocumentoQueryDTOSchema } from '@/features/vendas/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { findCustomerByDocument } from '@/src/server/vendas/customer-document.service';

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
  }

  const parsed = vendasClienteDocumentoQueryDTOSchema.safeParse({
    document: request.nextUrl.searchParams.get('document') ?? '',
    uiRequestId: request.nextUrl.searchParams.get('uiRequestId'),
  });

  if (!parsed.success) {
    return json(422, {
      error: 'DOCUMENTO_INVALIDO',
      message: 'CPF/CNPJ inválido.',
    });
  }

  const { contaId } = auth;
  const document = parsed.data.document;
  const match = await findCustomerByDocument({
    contaId,
    document,
    uiRequestId: parsed.data.uiRequestId,
  });

  return json(200, {
    exists: Boolean(match),
    match,
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
