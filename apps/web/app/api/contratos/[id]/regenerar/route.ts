import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { contratoDTOSchema, contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
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

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser();
  if (!user?.contaId) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const { id } = contratoRouteParamsDTOSchema.parse(params);
    const contrato = await prisma.contrato.findFirst({
      where: {
        id,
        matricula: { aluno: { contaId: user.contaId } },
      },
      include: {
        matricula: {
          select: { id: true },
        },
      },
    });

    if (!contrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado' } },
        { status: 404 },
      );
    }

    if (contrato.status === 'ASSINADO' || contrato.status === 'CANCELADO') {
      return NextResponse.json(
        { error: { message: 'Não é possível regenerar link para este contrato' } },
        { status: 400 },
      );
    }

    const novaExpiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tokenPublico = crypto.randomUUID();

    await prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        tokenPublico,
        tokenExpiraEm: novaExpiracao,
        status: 'PENDENTE',
      },
    });

    await prisma.matricula.update({
      where: { id: contrato.matricula.id },
      data: {
        contratoAtualId: contrato.id,
        statusContrato: 'AGUARDANDO_ASSINATURA',
      },
    });

    const hydratedContrato = await getContratoWithRelations(contrato.id, user.contaId);

    if (!hydratedContrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado após regeneração' } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      contratoDTOSchema.parse(mapContratoRecordToDTO(hydratedContrato)),
    );
  } catch (error) {
    console.error('[CONTRATO_REGENERAR]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao regenerar link do contrato' } },
      { status: 500 },
    );
  }
}
