import { NextRequest, NextResponse } from 'next/server';
import { createContractCancelledNotification } from '@alusa/lib';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { deleteContratoResultDTOSchema } from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';

async function getContratoWithRelations(id: string, contaId: string) {
  return prisma.contrato.findFirst({
    where: {
      id,
      matricula: { aluno: { contaId } },
    },
    include: {
      modelo: {
        select: {
          id: true,
          nome: true,
        },
      },
      matricula: {
        select: {
          id: true,
          contratoAtualId: true,
          aluno: {
            select: {
              id: true,
              nome: true,
              cpf: true,
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
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const contrato = await getContratoWithRelations(params.id, user.contaId);

    if (!contrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado' } },
        { status: 404 },
      );
    }

    return NextResponse.json(mapContratoRecordToDTO(contrato));
  } catch (error) {
    console.error('[CONTRATO_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao buscar contrato' } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const contrato = await prisma.contrato.findFirst({
      where: {
        id: params.id,
        matricula: { aluno: { contaId: user.contaId } },
      },
      include: {
        matricula: {
          select: {
            contratoAtualId: true,
            id: true,
            aluno: { select: { nome: true } },
          },
        },
      },
    });

    if (!contrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado' } },
        { status: 404 },
      );
    }

    if (contrato.status === 'ASSINADO') {
      return NextResponse.json(
        { error: { message: 'Não é possível cancelar um contrato já assinado' } },
        { status: 400 },
      );
    }

    await prisma.contrato.update({
      where: { id: params.id },
      data: { status: 'CANCELADO' },
    });

    if (contrato.matricula.contratoAtualId === contrato.id) {
      await prisma.matricula.update({
        where: { id: contrato.matricula.id },
        data: { statusContrato: 'CANCELADO', contratoAtualId: null },
      });
    }

    void createContractCancelledNotification({
      contaId: user.contaId,
      contratoId: contrato.id,
      matriculaId: contrato.matricula.id,
      alunoNome: contrato.matricula.aluno.nome ?? 'Aluno',
    });

    return NextResponse.json(
      deleteContratoResultDTOSchema.parse({
        message: 'Contrato cancelado com sucesso',
      }),
    );
  } catch (error) {
    console.error('[CONTRATO_DELETE]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao cancelar contrato' } },
      { status: 500 },
    );
  }
}
