import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import {
  createResponsavelInputDTOSchema,
  createResponsavelResultDTOSchema,
  listResponsaveisQueryDTOSchema,
  listResponsaveisResultDTOSchema,
} from '@/features/responsaveis/dtos';
import {
  mapCreateResponsavelDTOToData,
  mapListResponsaveisQueryToFilters,
  mapResponsavelRecordToMaskedSummaryDTO,
  mapResponsavelRecordToSummaryDTO,
} from '@/features/responsaveis/mappers';

/**
 * GET /api/responsaveis
 * Lista responsáveis (busca por nome/CPF)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.user?.contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const contaId = session.user.contaId;
    const { searchParams } = new URL(req.url);
    const parsedQuery = listResponsaveisQueryDTOSchema.safeParse({
      q: searchParams.get('q') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Parâmetros inválidos',
          details: parsedQuery.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const filters = mapListResponsaveisQueryToFilters(parsedQuery.data, contaId);

    // Multi-tenant: sempre filtrar por contaId
    const responsaveis = await prisma.responsavel.findMany({
      where: {
        contaId: filters.contaId,
        ...(filters.search
          ? {
              OR: [
                { nome: { contains: filters.search, mode: 'insensitive' as const } },
                ...(filters.cpfDigits
                  ? [{ cpf: { contains: filters.cpfDigits, mode: 'insensitive' as const } }]
                  : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        telefone: true,
        financeiro: true,
        _count: {
          select: {
            alunos: true,
          },
        },
      },
      orderBy: { nome: 'asc' },
      take: filters.take,
    });

    const dto = listResponsaveisResultDTOSchema.parse({
      items: responsaveis.map(mapResponsavelRecordToMaskedSummaryDTO),
    });

    return NextResponse.json(dto);
  } catch (error) {
    console.error('[API /api/responsaveis GET]', error);
    return NextResponse.json({ error: 'Erro ao buscar responsáveis' }, { status: 500 });
  }
}

/**
 * POST /api/responsaveis
 * Cria novo responsável
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.user?.contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const contaId = session.user.contaId;
    const raw = await req.json().catch(() => null);

    const validation = createResponsavelInputDTOSchema.safeParse(raw);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Dados inválidos',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const data = validation.data;

    // Multi-tenant: verificar se CPF ou email já existe NESTA CONTA
    const cpfDigits = data.cpf.replace(/\D/g, '');
    const existente = await prisma.responsavel.findFirst({
      where: {
        contaId,
        OR: [{ cpf: cpfDigits }, ...(data.email ? [{ email: data.email }] : [])],
      },
    });

    if (existente) {
      if (existente.cpf === cpfDigits) {
        return NextResponse.json({ error: 'CPF já cadastrado nesta conta' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Email já cadastrado nesta conta' }, { status: 409 });
    }

    // Criar responsável com contaId
    const responsavel = await prisma.responsavel.create({
      data: mapCreateResponsavelDTOToData(data, contaId),
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        telefone: true,
        financeiro: true,
        _count: {
          select: {
            alunos: true,
          },
        },
      },
    });

    const dto = createResponsavelResultDTOSchema.parse(
      mapResponsavelRecordToSummaryDTO({
        ...responsavel,
        cpf: responsavel.cpf || cpfDigits,
      }),
    );

    return NextResponse.json(dto, { status: 201 });
  } catch (error) {
    console.error('[API /api/responsaveis POST]', error);
    return NextResponse.json({ error: 'Erro ao criar responsável' }, { status: 500 });
  }
}
