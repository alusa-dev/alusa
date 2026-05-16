import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { supportAsaasSaveManualApiKeySchema } from '@/features/support/actions/schemas';
import {
  auditActorFromSession,
  recordSupportAudit,
  requestAuditMetadata,
} from '@/features/support/audit/support-audit.server';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { saveManualSubaccountApiKey } from '@alusa/finance';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-asaas-save-manual-api-key',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = supportAsaasSaveManualApiKeySchema.parse(await req.json());

    const result = await saveManualSubaccountApiKey({
      contaId: body.contaId,
      apiKey: body.apiKey,
      reason: body.reason,
      allowLocalValidationFallback: body.confirmations.generatedWithLocalScript,
      actor: { type: 'ADMIN', id: auth.session.username },
    });

    const meta = requestAuditMetadata(req);

    if (!result.ok) {
      await recordSupportAudit({
        ...auditActorFromSession(auth.session),
        ...meta,
        contaId: body.contaId,
        entityType: 'AsaasAccount',
        entityId: body.contaId,
        action: 'support.asaas.manual_api_key_failed',
        reason: body.reason,
        metadata: { errorCode: result.errorCode, summary: result.summary },
      });

      return NextResponse.json(
        { success: false, error: result.summary, errorCode: result.errorCode },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }

    await recordSupportAudit({
      ...auditActorFromSession(auth.session),
      ...meta,
      contaId: body.contaId,
      entityType: 'AsaasAccount',
      entityId: body.contaId,
      action: 'support.asaas.manual_api_key_saved',
      reason: body.reason,
      metadata: {
        apiKeyStatus: result.apiKeyStatus,
        asaasAccountId: result.asaasAccountId,
        webhook: result.webhook,
        reconcile: result.reconcile,
        warnings: result.warnings,
      },
    });

    return NextResponse.json(
      { success: true, data: result },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const message =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join('; ')
        : 'Erro ao salvar API Key manual';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
