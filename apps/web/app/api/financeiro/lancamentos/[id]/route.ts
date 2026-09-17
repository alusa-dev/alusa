import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  financeiroLancamentoInputDTOSchema,
  financeiroLancamentoMutationResultDTOSchema,
  financeiroRouteIdParamsDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroLancamentoRecordToDTO } from '@/features/financeiro/mappers';
import { financeInternalError } from '@/lib/api/finance-api-response';
import { logMethodNotAllowed } from '@/lib/security/http-method-observability';
import {
  getFinanceiroLancamento,
  updateFinanceiroLancamento,
} from '@/src/server/finance/lancamento.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function relationName(value: unknown): string | null {
  const record = asRecord(value);
  return typeof record.nome === 'string' ? record.nome : null;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function serializeLancamento(value: unknown) {
  const l = asRecord(value);
  return {
    id: l.id,
    tipo: l.tipo,
    origem: l.origem,
    status: l.status,
    valor: Number(l.valor),
    descricao: l.descricao,
    referencia: l.referencia,
    centroCustoId: l.centroCustoId,
    centroCustoNome: relationName(l.centroCusto),
    categoriaId: l.categoriaId,
    categoriaNome: relationName(l.categoria),
    subcategoriaId: l.subcategoriaId,
    subcategoriaNome: relationName(l.subcategoria),
    formaPagamento: l.formaPagamento,
    dataEfetiva: isoDate(l.dataEfetiva),
    dataPrevista: isoDate(l.dataPrevista),
    isEstorno: l.isEstorno,
    parentId: l.parentId,
    dataEstorno: isoDate(l.dataEstorno),
    motivoEstorno: l.motivoEstorno ?? null,
    observacao: l.observacao ?? null,
    anexoUrl: l.anexoUrl ?? null,
    externalRef: l.externalRef ?? null,
    createdById: l.createdById ?? null,
    createdAt: isoDate(l.createdAt),
    updatedAt: isoDate(l.updatedAt),
  };
}

async function ensureAuth() {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return {
      error: err(
        auth.reason === 'CONTA_MISMATCH' ? 403 : 401,
        auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuario nao autenticado',
      ),
    };
  }
  if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
    return { error: err(403, 'SEM_PERMISSAO', 'Acesso negado') };
  }
  return { user: { id: auth.userId, contaId: auth.contaId } };
}

function mutationError(result: { code: string; message: string }) {
  return err(result.code === 'NAO_ENCONTRADO' ? 404 : 400, result.code, result.message);
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const { id } = financeiroRouteIdParamsDTOSchema.parse(await params);
    const lancamento = await getFinanceiroLancamento({ contaId: auth.user.contaId, lancamentoId: id });
    if (!lancamento) return err(404, 'NAO_ENCONTRADO', 'Lancamento nao encontrado');
    return NextResponse.json(
      financeiroLancamentoMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoRecordToDTO(serializeLancamento(lancamento)),
      }),
    );
  } catch (error) {
    return financeInternalError('API lancamentos GET id', error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const { id } = financeiroRouteIdParamsDTOSchema.parse(await params);
    const parsed = financeiroLancamentoInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      return err(400, 'DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos');
    }

    const result = await updateFinanceiroLancamento({
      contaId: auth.user.contaId,
      lancamentoId: id,
      data: parsed.data,
    });
    if (!result.ok) return mutationError(result);

    return NextResponse.json(
      financeiroLancamentoMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoRecordToDTO(serializeLancamento(result.data)),
      }),
    );
  } catch (error) {
    return financeInternalError('API lancamentos PUT', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    logMethodNotAllowed(req, ['GET', 'PUT'], 'financial_entries_are_reversed_not_deleted');
    return err(405, 'NAO_SUPORTADO', 'Lancamento nao pode ser excluido. Use estorno/ajuste.');
  } catch (error) {
    return financeInternalError('API lancamentos DELETE', error);
  }
}
