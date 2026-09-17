/**
 * API de Cobranças com Cálculo Dinâmico de Status
 *
 * Esta API implementa o padrão profissional onde:
 * 1. Status são calculados dinamicamente baseados na data de vencimento
 * 2. Status finais (PAGO, CANCELADO, ESTORNADO) são imutáveis
 * 3. Retorna dados enriquecidos com informações de matrícula e aluno
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiJson, apiJsonCreated } from '@/lib/api/standard-response';
import { invalidateChargesCache } from '@/lib/cache/invalidation';
import { createLegacyCobranca, listLegacyCobrancas } from '@/src/server/finance/cobranca-legacy.service';
import {
  createLegacyCobrancaInputDTOSchema,
  createLegacyCobrancaResultDTOSchema,
  listLegacyCobrancasQueryDTOSchema,
  listLegacyCobrancasResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import {
  mapCreateLegacyCobrancaResultToDTO,
  mapLegacyCobrancaListItemToDTO,
} from '@/features/financeiro/cobrancas/mappers';
import { ZodError } from 'zod';

/**
 * GET /api/cobrancas
 *
 * Lista cobranças com filtros e cálculo dinâmico de status
 *
 * Query params:
 * - matriculaId: ID da matrícula (opcional)
 * - status: Filtrar por status (opcional)
 * - tipo: Filtrar por tipo (opcional)
 * - dataInicio: Data inicial para filtro de vencimento (opcional)
 * - dataFim: Data final para filtro de vencimento (opcional)
 * - limit: Limite de resultados (padrão: 50)
 * - offset: Offset para paginação (padrão: 0)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    // Extrair parâmetros de query
    const query = listLegacyCobrancasQueryDTOSchema.parse({
      matriculaId: searchParams.get('matriculaId') || undefined,
      status: searchParams.get('status') || undefined,
      tipo: searchParams.get('tipo') || undefined,
      dataInicio: searchParams.get('dataInicio') || undefined,
      dataFim: searchParams.get('dataFim') || undefined,
      limit: parseInt(searchParams.get('limit') || '50'),
      offset: parseInt(searchParams.get('offset') || '0'),
    });
    const data = await listLegacyCobrancas({ contaId: auth.contaId, query });

    return apiJson(
      listLegacyCobrancasResultDTOSchema.parse({
        data: data.data.map((item) =>
          mapLegacyCobrancaListItemToDTO(item as unknown as Record<string, unknown>),
        ),
        pagination: data.pagination,
      }),
    );
  } catch (error) {
    console.error('[API Cobranças] Erro ao listar cobranças:', error);
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Parâmetros de consulta inválidos', code: 'ERRO_VALIDACAO' },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: 'Erro ao listar cobranças', code: 'ERRO_LISTAR_COBRANCAS' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/cobrancas
 *
 * Cria uma nova cobrança (uso interno/administrativo)
 *
 * ⚠️ IMPORTANTE: Cobranças normalmente são criadas automaticamente
 * durante o processo de matrícula. Esta rota é para casos especiais.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Verificar se usuário tem permissão (ADMIN ou FINANCEIRO)
    if (!auth.role || !['ADMIN', 'FINANCEIRO'].includes(auth.role)) {
      return NextResponse.json({ error: 'Sem permissão para criar cobranças' }, { status: 403 });
    }

    const body = createLegacyCobrancaInputDTOSchema.parse(await req.json());

    const result = await createLegacyCobranca({
      contaId: auth.contaId,
      userId: auth.userId,
      userName: auth.name,
      input: body,
    });

    if (!result.ok && result.reason === 'MATRICULA_NOT_FOUND') {
      return NextResponse.json({ error: 'Matrícula não encontrada' }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Aluno inativo não pode receber nova cobrança' },
        { status: 409 },
      );
    }

    void invalidateChargesCache(auth.contaId, 'cobranca-created').catch((cacheError) => {
      console.warn('[cache][invalidate] cobranca-created failed', cacheError);
    });

    return apiJsonCreated(
      createLegacyCobrancaResultDTOSchema.parse(
        mapCreateLegacyCobrancaResultToDTO({
          success: true,
          data: result.data,
        }),
      ),
    );
  } catch (error) {
    console.error('[API Cobranças] Erro ao criar cobrança:', error);
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Dados da cobrança inválidos', code: 'ERRO_VALIDACAO' },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: 'Erro ao criar cobrança', code: 'ERRO_CRIAR_COBRANCA' },
      { status: 500 },
    );
  }
}
