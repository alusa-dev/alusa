import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import {
  deleteContratoModeloResultDTOSchema,
  updateContratoModeloInputDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoModeloRecordToDTO } from '@/features/contratos/mappers';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Não autorizado' } },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const modelo = await prisma.contratoModelo.findFirst({
      where: {
        id,
        contaId: user.contaId,
      },
      include: {
        _count: {
          select: { contratos: true },
        },
      },
    });

    if (!modelo) {
      return NextResponse.json(
        { error: { message: 'Modelo não encontrado' } },
        { status: 404 }
      );
    }

    return NextResponse.json(mapContratoModeloRecordToDTO(modelo));
  } catch (error) {
    console.error('[MODELO_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao buscar modelo' } },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Não autorizado' } },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const json = await request.json();
    const body = updateContratoModeloInputDTOSchema.parse(json);

    // Verificar se modelo existe e pertence à conta
    const existing = await prisma.contratoModelo.findFirst({
      where: { id, contaId: user.contaId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { message: 'Modelo não encontrado' } },
        { status: 404 }
      );
    }

    // Se renomeando, verificar duplicidade
    if (body.nome && body.nome !== existing.nome) {
      const duplicate = await prisma.contratoModelo.findFirst({
        where: {
          contaId: user.contaId,
          nome: body.nome,
          status: 'ATIVO',
          id: { not: id },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: { message: 'Já existe um modelo ativo com esse nome' } },
          { status: 409 }
        );
      }
    }

    const modelo = await prisma.contratoModelo.update({
      where: { id },
      data: body,
    });

    return NextResponse.json(mapContratoModeloRecordToDTO(modelo));
  } catch (error) {
    console.error('[MODELO_PUT]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao atualizar modelo' } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Não autorizado' } },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const existing = await prisma.contratoModelo.findFirst({
      where: { id, contaId: user.contaId },
      include: {
        _count: {
          select: { contratos: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { message: 'Modelo não encontrado' } },
        { status: 404 }
      );
    }

    // Se tem contratos vinculados, apenas inativar
    if (existing._count.contratos > 0) {
      await prisma.contratoModelo.update({
        where: { id },
        data: { status: 'INATIVO' },
      });

      return NextResponse.json(
        deleteContratoModeloResultDTOSchema.parse({
          message: 'Modelo inativado (possui contratos vinculados)',
          inactivated: true,
        }),
      );
    }

    // Se não tem contratos, pode deletar
    await prisma.contratoModelo.delete({
      where: { id },
    });

    return NextResponse.json(
      deleteContratoModeloResultDTOSchema.parse({
        message: 'Modelo excluído com sucesso',
      }),
    );
  } catch (error) {
    console.error('[MODELO_DELETE]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao excluir modelo' } },
      { status: 500 }
    );
  }
}
