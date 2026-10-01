import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  costCenterInputDTOSchema,
  centroCustoMutationResultDTOSchema,
  costCenterQueryDTOSchema,
  listCentroCustoResultDTOSchema,
} from '@/features/finance/operations/cost-centers/dtos';
import {
  mapCostCenterToDTO,
  mapListCentroCustoResultToDTO,
} from '@/features/finance/operations/cost-centers/mappers';
import {
  createCostCenter,
  findDuplicateCostCenter,
  listCostCenters,
} from '@/src/server/finance/cost-center.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export const centroCustoCreateSchema = costCenterInputDTOSchema;

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuario nao autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const parsedQuery = costCenterQueryDTOSchema.safeParse({
      tipo: url.searchParams.get('tipo') || undefined,
      status: url.searchParams.get('status') || 'ATIVO',
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { tipo, status } = parsedQuery.data;

    const data = await listCostCenters(auth.contaId, { tipo, status });

    return NextResponse.json(
      listCentroCustoResultDTOSchema.parse(
        mapListCentroCustoResultToDTO({
          data: data.map((item) => mapCostCenterToDTO(item as unknown as Record<string, unknown>)),
        }),
      ),
    );
  } catch (e) {
    logFinanceApiError('/api/financeiro/centros-custo', e);
    return err(500, 'ERRO_INTERNO', 'Não foi possível carregar os centros de custo');
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuario nao autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const parsed = costCenterInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    const normalizedInput = { ...body, nome: body.nome.trim(), descricao: body.descricao?.trim() || null };
    const existing = await findDuplicateCostCenter(auth.contaId, normalizedInput);
    if (existing) return err(409, 'JA_EXISTE', 'Centro de custo já existe para este tipo');

    const created = await createCostCenter(auth.contaId, normalizedInput);

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCostCenterToDTO(created as unknown as Record<string, unknown>),
      }),
      { status: 201 },
    );
  } catch (e) {
    logFinanceApiError('/api/financeiro/centros-custo', e);
    return err(500, 'ERRO_INTERNO', 'Não foi possível criar o centro de custo');
  }
}
