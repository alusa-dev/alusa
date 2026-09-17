import { NextResponse } from 'next/server';
import { KycNotApprovedError } from '@alusa/finance';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  matriculaRouteParamsDTOSchema,
  updateMatriculaJurosMultaInputDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import { updateEnrollmentTerms } from '@/src/server/matriculas/update-enrollment-terms.service';

function jsonError(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsedBody = updateMatriculaJurosMultaInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return jsonError(400, {
        error: {
          code: 'PAYLOAD_INVALIDO',
          message: parsedBody.error.issues[0]?.message ?? 'Payload inválido',
          details: parsedBody.error.issues,
        },
      });
    }

    const contaCtx = await resolveTenantSession(parsedBody.data.contaId ?? null);
    if (!contaCtx.ok) {
      return jsonError(contaCtx.reason === 'CONTA_MISMATCH' ? 403 : 401, {
        error: {
          code: contaCtx.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
          message: contaCtx.reason === 'CONTA_MISMATCH'
            ? 'Conta informada não pertence ao usuário.'
            : 'Usuário não autenticado',
        },
      });
    }

    const { id: matriculaId } = matriculaRouteParamsDTOSchema.parse(await ctx.params);
    const result = await updateEnrollmentTerms({
      matriculaId,
      contaId: contaCtx.contaId,
      userId: contaCtx.userId,
      input: parsedBody.data,
    });
    if (result.kind === 'FAILURE') return jsonError(result.status, result.body);

    return NextResponse.json(result.data, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[ASAAS_SYNC] Erro ao atualizar juros e multa:', error);
    if (error instanceof KycNotApprovedError) {
      return jsonError(409, {
        error: {
          code: 'KYC_NAO_APROVADO',
          message: 'Conta não aprovada para operações financeiras',
        },
      });
    }
    return jsonError(500, {
      error: {
        code: 'ERRO_ATUALIZAR_JUROS_MULTA',
        message: 'Não foi possível atualizar juros e multa.',
      },
    });
  }
}
