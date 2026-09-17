import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { matriculaTaxaUpdateInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { updateMatriculaEnrollmentFee } from '@/src/server/matriculas/matricula-fee.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return error(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida.' : 'Usuário não autenticado.');
  if (!allowedRoles.has(String(auth.role).toUpperCase())) return error(403, 'PERMISSAO_NEGADA', 'Usuário sem permissão para alterar taxas.');
  const parsed = matriculaTaxaUpdateInputDTOSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, 'PAYLOAD_INVALIDO', parsed.error.issues[0]?.message ?? 'Valor inválido.');
  const { id } = await context.params;
  const result = await updateMatriculaEnrollmentFee({ matriculaId: id, contaId: auth.contaId, actorUserId: auth.userId, value: parsed.data.value });
  if (!result.ok) return error(result.status, result.code, result.message);
  return NextResponse.json({ success: true, value: result.value, resultingChargeValue: result.resultingChargeValue, message: 'Taxa atualizada e confirmada no Asaas.' });
}
