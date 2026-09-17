import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  financeiroLancamentoInputDTOSchema,
  financeiroLancamentoMutationResultDTOSchema,
  listFinanceiroLancamentosResultDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroLancamentoRecordToDTO } from '@/features/financeiro/mappers';
import { financeInternalError } from '@/lib/api/finance-api-response';
import {
  createFinanceiroLancamento,
  listFinanceiroLancamentos,
} from '@/src/server/finance/lancamento.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
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
  const valorNumber = Number(l.valor);
  return {
    id: l.id,
    tipo: l.tipo,
    origem: l.origem,
    status: l.status,
    valor: valorNumber,
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
    nomeCobranca: l.nomeCobranca ?? null,
    valorBruto: l.valorBruto ?? null,
    valorTaxa: l.valorTaxa ?? null,
    valorLiquido: l.valorLiquido ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const tipo = url.searchParams.get('tipo') || undefined;
    const status = url.searchParams.getAll('status').filter(Boolean);
    const origem = url.searchParams.getAll('origem').filter(Boolean);
    const centroCustoId = url.searchParams.get('centroCustoId') || undefined;
    const categoriaId = url.searchParams.get('categoriaId') || undefined;
    const subcategoriaId = url.searchParams.get('subcategoriaId') || undefined;
    const search = url.searchParams.get('q')?.trim();
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const sort = url.searchParams.get('sort') === 'valor' ? 'valor' : 'dataEfetiva';
    const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';

    const result = await listFinanceiroLancamentos({
      contaId: user.contaId,
      page,
      pageSize,
      tipo,
      status,
      origem,
      centroCustoId,
      categoriaId,
      subcategoriaId,
      search,
      from,
      to,
      sort,
      order,
    });

    return NextResponse.json(
      listFinanceiroLancamentosResultDTOSchema.parse({
        data: result.items.map((item) =>
          mapFinanceiroLancamentoRecordToDTO(serializeLancamento(item)),
        ),
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
        totals: result.totals,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return financeInternalError('API lancamentos GET', e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const parsed = financeiroLancamentoInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }

    const body = parsed.data;
    const result = await createFinanceiroLancamento({
      contaId: user.contaId,
      userId: user.id,
      data: body,
    });
    if (!result.ok) return err(400, 'DADOS_INVALIDOS', result.message);

    return NextResponse.json(
      financeiroLancamentoMutationResultDTOSchema.parse({
        data: mapFinanceiroLancamentoRecordToDTO(serializeLancamento(result.data)),
      }),
      { status: 201 },
    );
  } catch (e) {
    return financeInternalError('API lancamentos POST', e);
  }
}
