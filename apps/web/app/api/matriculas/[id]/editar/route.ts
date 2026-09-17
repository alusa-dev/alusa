import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiJsonError } from '@/lib/api/standard-response';
import { editMatriculaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { MatriculaConflictError } from '@/src/server/matriculas/matricula.service';
import {
  editMatriculaForHttp,
  EditMatriculaHttpError,
} from '@/src/server/matriculas/edit-matricula.service';
import { mapMatriculaRuleError } from '@/src/server/matriculas/matricula-http-error';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJsonError(status, code, message, details);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const json = await req.json().catch(() => null);
    const parsedBody = editMatriculaInputDTOSchema.safeParse(json);
    if (!parsedBody.success) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsedBody.error.issues[0]?.message ?? 'Payload inválido',
        parsedBody.error.issues,
      );
    }

    const contaCtx = await resolveTenantSession(parsedBody.data.contaId ?? null);
    if (!contaCtx.ok) {
      return jsonError(
        contaCtx.reason === 'CONTA_MISMATCH' ? 403 : 401,
        contaCtx.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        contaCtx.reason === 'CONTA_MISMATCH'
          ? 'Conta informada não pertence ao usuário.'
          : 'Usuário não autenticado',
      );
    }

    try {
      await assertPlatformAccessForConta({ contaId: contaCtx.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    const result = await editMatriculaForHttp({
      matriculaId: id,
      contaId: contaCtx.contaId,
      userId: contaCtx.userId,
      body: parsedBody.data,
    });
    return NextResponse.json(result.payload, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[EDITAR_MATRICULA] Falha ao editar matrícula', {
      code: error instanceof EditMatriculaHttpError || error instanceof MatriculaConflictError
        ? error.code
        : 'ERRO_EDITAR_MATRICULA',
    });
    if (error instanceof EditMatriculaHttpError) {
      return jsonError(error.status, error.code, error.message, error.details);
    }
    if (error instanceof MatriculaConflictError) {
      return jsonError(409, error.code, error.message);
    }
    const ruleError = mapMatriculaRuleError(error);
    if (ruleError) return jsonError(ruleError.status, ruleError.code, ruleError.message);
    return jsonError(500, 'ERRO_EDITAR_MATRICULA', 'Não foi possível editar a matrícula.');
  }
}
