import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  financeiroLancamentoEstornoInputDTOSchema,
  financeiroLancamentoMutationResultDTOSchema,
  financeiroRouteIdParamsDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroLancamentoRecordToDTO } from '@/features/financeiro/mappers';
import { financeInternalError } from '@/lib/api/finance-api-response';
import { estornarFinanceiroLancamento } from '@/src/server/finance/lancamento.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return err(
        auth.reason === 'CONTA_MISMATCH' ? 403 : 401,
        auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuario nao autenticado',
      );
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const { id } = financeiroRouteIdParamsDTOSchema.parse(await params);
    const parsed = financeiroLancamentoEstornoInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      return err(400, 'DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos');
    }

    const result = await estornarFinanceiroLancamento({
      contaId: auth.contaId,
      userId: auth.userId,
      lancamentoId: id,
      dataEstorno: parsed.data.dataEstorno,
      motivo: parsed.data.motivo,
    });
    if (!result.ok) {
      return err(result.code === 'NAO_ENCONTRADO' ? 404 : 400, result.code, result.message);
    }

    return NextResponse.json(
      financeiroLancamentoMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoRecordToDTO({
          ...result.data,
          centroCustoNome: result.data.centroCusto?.nome ?? null,
          categoriaNome: result.data.categoria?.nome ?? null,
          subcategoriaNome: result.data.subcategoria?.nome ?? null,
        }),
      }),
    );
  } catch (error) {
    return financeInternalError('API lancamentos ESTORNAR', error);
  }
}
