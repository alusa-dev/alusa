import { NextResponse } from 'next/server';

import {
  auditActorFromSession,
  recordSupportAudit,
  requestAuditMetadata,
} from '@/features/support/audit/support-audit.server';
import { supportAsaasRecoverSchema } from '@/features/support/actions/schemas';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { recoverWhitelabelBaasViaParentAccount } from '@alusa/finance';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-recover-asaas-connection',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = supportAsaasRecoverSchema.parse(await req.json());

    const result = await recoverWhitelabelBaasViaParentAccount({
      contaId: body.contaId,
      reason: body.reason,
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
        action: 'support.asaas.recover_failed',
        reason: body.reason,
        metadata: { errorCode: result.errorCode, summary: result.summary, status: result.status ?? null },
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
      action: 'support.asaas.recover_complete',
      reason: body.reason,
      metadata: {
        keyRestored: result.keyRestored,
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao recuperar integração Asaas' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
