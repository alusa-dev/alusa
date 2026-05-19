/**
 * API de Cobranças com Cálculo Dinâmico de Status
 *
 * Esta API implementa o padrão profissional onde:
 * 1. Status são calculados dinamicamente baseados na data de vencimento
 * 2. Status finais (PAGO, CANCELADO, ESTORNADO) são imutáveis
 * 3. Retorna dados enriquecidos com informações de matrícula e aluno
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@alusa/lib/prisma';
import { calculateDynamicStatus } from '@/lib/asaas-status-mapper';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { invalidateChargesCache } from '@/lib/cache/invalidation';
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
    const session = await getServerSession(authOptions);

    if (!session?.user) {
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
    const { matriculaId, status, tipo, dataInicio, dataFim, limit, offset } = query;

    // Construir filtros - MULTI-TENANT: sempre filtrar pela conta do usuário
    const contaId = session.user.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Conta não identificada' }, { status: 400 });
    }

    const where: Record<string, unknown> = {
      matricula: { aluno: { contaId } },
    };

    if (matriculaId) {
      where.matriculaId = matriculaId;
    }

    if (status) {
      where.status = status;
    }

    if (tipo) {
      where.tipo = tipo;
    }

    if (dataInicio || dataFim) {
      const vencimentoFilter: { gte?: Date; lte?: Date } = {};
      if (dataInicio) {
        vencimentoFilter.gte = new Date(String(dataInicio));
      }
      if (dataFim) {
        vencimentoFilter.lte = new Date(String(dataFim));
      }
      where.vencimento = vencimentoFilter;
    }

    // Buscar cobranças
    const [cobrancas, total] = await Promise.all([
      prisma.cobranca.findMany({
        where,
        include: {
          matricula: {
            include: {
              aluno: {
                select: {
                  id: true,
                  nome: true,
                  email: true,
                  telefone: true,
                  foto: true,
                },
              },
              plano: {
                select: {
                  id: true,
                  nome: true,
                  valor: true,
                },
              },
              turma: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
          pagamentos: {
            orderBy: {
              dataPagamento: 'desc',
            },
            take: 1,
          },
        },
        orderBy: {
          vencimento: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.cobranca.count({ where }),
    ]);

    // ⭐ APLICAR CÁLCULO DINÂMICO DE STATUS
    const cobrancasComStatusAtualizado = cobrancas.map((cobranca) => ({
      ...cobranca,
      // Calcular status dinâmico mantendo imutabilidade de status finais
      statusCalculado: calculateDynamicStatus(cobranca.status, cobranca.vencimento),
      // Informações derivadas úteis para UI
      diasAteVencimento: Math.floor(
        (new Date(cobranca.vencimento).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
      ),
      isPago: cobranca.status === 'PAGO',
      isEstornado: ['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(cobranca.status),
      isCancelado: cobranca.status === 'CANCELADO',
      podeReenviar: ['PENDENTE', 'ATRASADO', 'A_VENCER'].includes(cobranca.status),
    }));

    return NextResponse.json(
      listLegacyCobrancasResultDTOSchema.parse({
        data: cobrancasComStatusAtualizado.map((item) =>
          mapLegacyCobrancaListItemToDTO(item as unknown as Record<string, unknown>),
        ),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      }),
    );
  } catch (error) {
    console.error('[API Cobranças] Erro ao listar cobranças:', error);
    return NextResponse.json({ error: 'Erro ao listar cobranças' }, { status: 500 });
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
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Verificar se usuário tem permissão (ADMIN ou FINANCEIRO)
    if (!['ADMIN', 'FINANCEIRO'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Sem permissão para criar cobranças' }, { status: 403 });
    }

    const body = createLegacyCobrancaInputDTOSchema.parse(await req.json());

    // Validar campos obrigatórios
    const requiredFields: Array<keyof typeof body> = [
      'matriculaId',
      'valor',
      'vencimento',
      'competenciaInicio',
      'competenciaFim',
    ];
    const missingFields = requiredFields.filter((field) => !body[field]);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Campos obrigatórios faltando: ${missingFields.join(', ')}` },
        { status: 400 },
      );
    }

    // Verificar se matrícula existe - MULTI-TENANT
    const contaId = session.user.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Conta não identificada' }, { status: 400 });
    }

    const matricula = await prisma.matricula.findFirst({
      where: { id: body.matriculaId, aluno: { contaId } },
      include: {
        aluno: true,
      },
    });

    if (!matricula) {
      return NextResponse.json({ error: 'Matrícula não encontrada' }, { status: 404 });
    }
    if (matricula.aluno.status !== 'ATIVO') {
      return NextResponse.json(
        { error: 'Aluno inativo não pode receber nova cobrança' },
        { status: 409 },
      );
    }

    // Calcular status inicial baseado na data de vencimento
    const vencimento = new Date(body.vencimento);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    vencimento.setHours(0, 0, 0, 0);

    let statusInicial: 'PENDENTE' | 'A_VENCER' | 'ATRASADO' = 'PENDENTE';
    if (vencimento > hoje) {
      statusInicial = 'A_VENCER';
    } else if (vencimento < hoje) {
      statusInicial = 'ATRASADO';
    }

    // Criar cobrança
    const cobranca = await prisma.cobranca.create({
      data: {
        contaId,
        matriculaId: body.matriculaId,
        tipo: (body.tipo || 'MENSALIDADE') as any,
        descricao: body.descricao,
        competenciaInicio: new Date(body.competenciaInicio),
        competenciaFim: new Date(body.competenciaFim),
        valor: body.valor,
        vencimento: vencimento,
        formaPagamento: (body.formaPagamento || 'BOLETO') as any,
        status: statusInicial,
      },
      include: {
        matricula: {
          include: {
            aluno: {
              select: {
                id: true,
                nome: true,
                email: true,
              },
            },
          },
        },
      },
    });

    // Registrar no log financeiro
    await prisma.logFinanceiro.create({
      data: {
        contaId: matricula.aluno.contaId,
        usuarioId: session.user.id,
        cobrancaId: cobranca.id,
        acao: 'CRIAR_COBRANCA_MANUAL',
        detalhes: {
          valor: body.valor,
          vencimento: body.vencimento,
          tipo: body.tipo,
          descricao: body.descricao,
          criadoPor: session.user.name,
        },
      },
    });

    void invalidateChargesCache(contaId, 'cobranca-created').catch((cacheError) => {
      console.warn('[cache][invalidate] cobranca-created failed', cacheError);
    });

    return NextResponse.json(
      createLegacyCobrancaResultDTOSchema.parse(
        mapCreateLegacyCobrancaResultToDTO({
          success: true,
          data: cobranca,
        }),
      ),
    );
  } catch (error) {
    console.error('[API Cobranças] Erro ao criar cobrança:', error);
    return NextResponse.json({ error: 'Erro ao criar cobrança' }, { status: 500 });
  }
}
