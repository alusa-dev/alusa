import { NextResponse } from 'next/server';
import { matriculaBillingGroupsQueryDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { listMatriculaBillingGroups } from '@/src/server/matriculas/billing-views.service';

export const dynamic = 'force-dynamic';
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = matriculaBillingGroupsQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    responsavelId: url.searchParams.get('responsavelId'),
    payerType: url.searchParams.get('payerType'),
    payerId: url.searchParams.get('payerId'),
    formaPagamento: url.searchParams.get('formaPagamento'),
    vencimentoDia: url.searchParams.get('vencimentoDia'),
  });
  const tenant = await resolveTenantSession(query.contaId);
  if (!tenant.ok) return jsonError(tenant.reason === 'CONTA_MISMATCH' ? 403 : 401, tenant.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', tenant.reason === 'CONTA_MISMATCH' ? 'Conta informada nao pertence ao usuario.' : 'Usuario nao autenticado.');
  if (!allowedRoles.has(String(tenant.role).toUpperCase())) return jsonError(403, 'PERMISSAO_NEGADA', 'Usuario nao tem permissao para consultar cobranca.');

  const payerType = query.payerType ?? (query.responsavelId ? 'RESPONSAVEL' : null);
  const payerId = query.payerId ?? query.responsavelId;
  if (!payerType || !payerId) return jsonError(400, 'PAGADOR_OBRIGATORIO', 'Informe o pagador para consultar cobrancas.');

  const data = await listMatriculaBillingGroups({
    contaId: tenant.contaId,
    payerType,
    payerId,
    formaPagamento: query.formaPagamento ?? undefined,
    vencimentoDia: query.vencimentoDia ?? undefined,
  });
  return NextResponse.json({ data }, { headers: { 'cache-control': 'no-store' } });
}
