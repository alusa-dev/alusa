import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  anticipationTargetInputDTOSchema,
  requestReceivableAnticipation,
} from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isMultipart(contentType: string | null) {
  return contentType?.toLowerCase().includes('multipart/form-data') ?? false;
}

async function parseTargetAndDocument(req: NextRequest) {
  if (!isMultipart(req.headers.get('content-type'))) {
    return {
      target: anticipationTargetInputDTOSchema.parse(await req.json()),
      document: undefined,
      documentFilename: undefined,
    };
  }

  const form = await req.formData();
  const documentValue = form.get('document');
  const document =
    typeof Blob !== 'undefined' && documentValue instanceof Blob && documentValue.size > 0
      ? documentValue
      : undefined;
  const documentFilename =
    documentValue && typeof documentValue === 'object' && 'name' in documentValue
      ? String((documentValue as { name?: string }).name ?? 'documento.pdf')
      : undefined;

  return {
    target: anticipationTargetInputDTOSchema.parse({
      targetType: form.get('targetType'),
      payment: form.get('payment') || undefined,
      installment: form.get('installment') || undefined,
    }),
    document,
    documentFilename,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const { target, document, documentFilename } = await parseTargetAndDocument(req);
    const result = await requestReceivableAnticipation({
      contaId: auth.user.contaId,
      userId: auth.user.id,
      target,
      document,
      documentFilename,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }
    console.error('[API antecipacoes solicitar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
