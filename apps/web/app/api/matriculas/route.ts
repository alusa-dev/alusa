import { NextResponse } from 'next/server';
import { apiJsonError } from '@/lib/api/standard-response';
import { listMatriculasHttp } from '@/src/server/matriculas/list-matriculas-http.service';
import { createMatriculaHttp, isPrismaClientInfrastructureError } from '@/src/server/matriculas/create-matricula-http.service';
import { MatriculaConflictError } from '@/src/server/matriculas/matricula.service';
import { mapMatriculaRuleError } from '@/src/server/matriculas/matricula-http-error';
import { ImmediateEnrollmentCreationError } from '@/src/server/matriculas/create-immediate-enrollment.use-case';
import { EnrollmentContractModelSignatureFieldsError } from '@/src/server/contracts/create-pending-enrollment-contract.service';
import { isPlatformBillingCapacityError } from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const response = await listMatriculasHttp(req);
  return response.kind === 'OK' ? NextResponse.json(response.data) : response.response;
}

export async function POST(req: Request) {
  try {
    const response = await createMatriculaHttp({
      rawBody: await req.json().catch(() => null),
      idempotencyKey: req.headers.get('x-idempotency-key')?.trim() || null,
    });
    return response.kind === 'OK' ? NextResponse.json(response.data) : response.response;
  } catch (error) {
    console.error('Erro ao criar matrícula:', error);
    if (error instanceof ImmediateEnrollmentCreationError) {
      const isPreviewConflict = ['PREVIEW_EXPIRADO', 'PREVIEW_DESATUALIZADO', 'PREVIEW_INCOMPATIVEL'].includes(error.code);
      return apiJsonError(
        isPreviewConflict ? 409 : error.requiresReconciliation ? 503 : 422,
        error.code,
        error.message,
        { requiresReconciliation: error.requiresReconciliation, ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}) },
      );
    }
    if (error instanceof MatriculaConflictError) return apiJsonError(409, error.code, error.message);
    const ruleError = mapMatriculaRuleError(error);
    if (ruleError) return apiJsonError(ruleError.status, ruleError.code, ruleError.message);
    if (error instanceof EnrollmentContractModelSignatureFieldsError) return apiJsonError(422, 'MODELO_SEM_CAMPOS_ASSINATURA', error.message);
    if (error instanceof Error && error.message === 'PREVIEW_EXPIRADO') return apiJsonError(409, 'PREVIEW_EXPIRADO', 'O preview da matrícula expirou. Gere um novo preview antes de confirmar.');
    if (error instanceof Error && error.message === 'PREVIEW_DESATUALIZADO') return apiJsonError(409, 'PREVIEW_DESATUALIZADO', 'O preview da matrícula mudou. Revise os valores e confirme novamente.');
    if (error instanceof Error && error.message.startsWith('PREVIEW_INCOMPATIVEL:')) {
      const [, code, ...messageParts] = error.message.split(':');
      return apiJsonError(409, 'PREVIEW_INCOMPATIVEL', messageParts.join(':') || 'A composição financeira da matrícula não está compatível.', { code });
    }
    if (isPlatformBillingCapacityError(error)) return apiJsonError(422, error.code, error.message, error.details);
    if (isPrismaClientInfrastructureError(error)) {
      return apiJsonError(500, 'ERRO_INTERNO_MATRICULA', 'Falha interna ao preparar a matrícula. Atualize o servidor e tente novamente.');
    }
    return apiJsonError(500, 'ERRO_CRIAR_MATRICULA', 'Não foi possível criar a matrícula.');
  }
}
