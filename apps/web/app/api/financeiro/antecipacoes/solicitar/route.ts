import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { readBoundedFormData } from '@/lib/upload-request';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import { randomUUID } from 'node:crypto';

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

class UploadBodyError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function parseTargetAndDocument(req: NextRequest) {
  if (!isMultipart(req.headers.get('content-type'))) {
    return {
      target: anticipationTargetInputDTOSchema.parse(await req.json()),
      document: undefined,
      documentFilename: undefined,
    };
  }

  const uploadBody = await readBoundedFormData(req);
  if (!uploadBody.ok) throw new UploadBodyError(uploadBody.status, uploadBody.error);
  const form = uploadBody.formData;
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
    const rate = await rateLimitAsync(`anticipation-document:${auth.user.contaId}:${auth.user.id}`, 10, 10 * 60_000);
    if (!rate.ok) return json(429, { error: 'MUITAS_TENTATIVAS' });

    const { target, document, documentFilename } = await parseTargetAndDocument(req);
    const execute = () => requestReceivableAnticipation({ contaId: auth.user.contaId, userId: auth.user.id, target, document, documentFilename });
    if (!document) {
      const result = await execute();
      if (!result.success) return anticipationErrorResponse(result.error);
      return json(200, { data: result.data });
    }
    const quota = await withTenantUploadQuota({
      contaId: auth.user.contaId,
      fileSize: document.size,
      contentType: document.type || 'application/octet-stream',
      objectKey: `uploads/anticipation-reservations/${auth.user.contaId}/${randomUUID()}`,
      cleanup: async () => undefined,
      action: execute,
    });
    if (!quota.ok) return json(413, { error: 'QUOTA_UPLOAD_EXCEDIDA' });
    if (!quota.result.success) return anticipationErrorResponse(quota.result.error);
    return json(200, { data: quota.result.data });
  } catch (error) {
    if (error instanceof UploadBodyError) return json(error.status, { error: error.message });
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }
    console.error('[API antecipacoes solicitar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
