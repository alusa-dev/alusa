import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import {
  createContratoModeloInputDTOSchema,
  listContratoModelosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoModeloRecordToDTO } from '@/features/contratos/mappers';
import { ZodError } from 'zod';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Não autorizado' } },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');

  try {
    const modelos = await prisma.contratoModelo.findMany({
      where: {
        contaId: user.contaId,
        ...(statusFilter ? { status: statusFilter as 'ATIVO' | 'INATIVO' } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        contaId: true,
        nome: true,
        descricao: true,
        arquivoOriginalUrl: true,
        arquivoPdfUrl: true,
        mimeType: true,
        hashSha256: true,
        tamanhoBytes: true,
        versao: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { contratos: true },
        },
      },
    });

    return NextResponse.json(
      listContratoModelosResultDTOSchema.parse(
        modelos.map((modelo) => mapContratoModeloRecordToDTO(modelo)),
      ),
    );
  } catch (error) {
    console.error('[MODELOS_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao listar modelos de contrato' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Não autorizado' } },
      { status: 401 }
    );
  }

  try {
    const json = await request.json();
    const body = createContratoModeloInputDTOSchema.parse(json);

    // Verificar se já existe modelo com mesmo nome
    const existing = await prisma.contratoModelo.findFirst({
      where: {
        contaId: user.contaId,
        nome: body.nome,
        status: 'ATIVO',
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: { message: 'Já existe um modelo ativo com esse nome' } },
        { status: 409 }
      );
    }

    const modelo = await prisma.contratoModelo.create({
      data: {
        contaId: user.contaId,
        nome: body.nome,
        descricao: body.descricao,
        arquivoPdfUrl: body.arquivoPdfUrl,
        arquivoOriginalUrl: body.arquivoOriginalUrl,
        mimeType: body.mimeType || 'application/pdf',
        hashSha256: body.hashSha256,
        tamanhoBytes: body.tamanhoBytes,
        versao: 1,
        status: 'ATIVO',
      },
    });

    console.log('[MODELOS_POST] Modelo criado:', {
      id: modelo.id,
      nome: modelo.nome,
      contaId: user.contaId,
    });

    return NextResponse.json(mapContratoModeloRecordToDTO(modelo), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.errors[0]?.message ?? 'Dados inválidos';
      return NextResponse.json(
        { error: { message: first, details: error.errors } },
        { status: 400 }
      );
    }

    console.error('[MODELOS_POST]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao criar modelo de contrato' } },
      { status: 500 }
    );
  }
}
