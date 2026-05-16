import { NextResponse } from 'next/server';

import {
  auditActorFromSession,
  recordSupportAudit,
  requestAuditMetadata,
} from '@/features/support/audit/support-audit.server';
import { supportAsaasRepairSchema } from '@/features/support/actions/schemas';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { executeAsaasSupportRepair } from '@alusa/finance';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-asaas-support-repair',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = supportAsaasRepairSchema.parse(await req.json());

    const result = await executeAsaasSupportRepair({
      contaId: body.contaId,
      reason: body.reason,
      action: body.action,
      linkAsaasAccountId: body.linkAsaasAccountId,
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
        action: 'support.asaas.repair_failed',
        reason: body.reason,
        metadata: {
          errorCode: result.errorCode,
          summary: result.summary,
          action: body.action,
          finalDiagnosis: result.finalDiagnosis ?? null,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: result.summary,
          errorCode: result.errorCode,
          finalDiagnosis: result.finalDiagnosis ?? null,
        },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }

    await recordSupportAudit({
      ...auditActorFromSession(auth.session),
      ...meta,
      contaId: body.contaId,
      entityType: 'AsaasAccount',
      entityId: body.contaId,
      action: 'support.asaas.repair_complete',
      reason: body.reason,
      metadata: { steps: result.steps, action: body.action, finalDiagnosis: result.finalDiagnosis },
    });

    return NextResponse.json(
      { success: true, data: result },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao reparar integração Asaas' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
