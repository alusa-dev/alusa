import { NextRequest, NextResponse } from 'next/server';
import { canRegenerateContractLink } from '@alusa/domain';
import { createContractEvidence, createPublicContractToken } from '@alusa/lib';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { contratoDTOSchema, contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';

async function getContratoWithRelations(id: string, contaId: string) {
  return prisma.contrato.findFirst({
    where: {
      id,
      contaId,
      matricula: { contaId },
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
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user?.contaId) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const rawParams = await params;
    const { id } = contratoRouteParamsDTOSchema.parse(rawParams);
    const contrato = await prisma.contrato.findFirst({
      where: {
        id,
        contaId: user.contaId,
        matricula: { contaId: user.contaId },
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

    if (!canRegenerateContractLink(contrato.status)) {
      return NextResponse.json(
        { error: { message: 'Não é possível regenerar link para este contrato' } },
        { status: 400 },
      );
    }

    const novaExpiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { token: tokenPublico, tokenHash: tokenPublicoHash } = createPublicContractToken();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.contrato.updateMany({
        where: { id: contrato.id, contaId: user.contaId, status: contrato.status },
        data: {
          tokenPublico: `hash:${tokenPublicoHash}`,
          tokenPublicoHash,
          tokenExpiraEm: novaExpiracao,
          status: 'PENDENTE',
        },
      });
      if (updated.count !== 1) throw new Error('CONTRACT_CHANGED_CONCURRENTLY');

      await createContractEvidence(tx as never, {
        contaId: user.contaId,
        contratoId: contrato.id,
        type: 'PUBLIC_LINK_CREATED',
        actorType: 'USER',
        actorId: user.id,
        payload: {
          tokenPublicoHash,
          tokenExpiraEm: novaExpiracao.toISOString(),
          regenerated: true,
        },
      });

      await tx.matricula.updateMany({
        where: { id: contrato.matricula.id, contaId: user.contaId },
        data: { contratoAtualId: contrato.id, statusContrato: 'AGUARDANDO_ASSINATURA' },
      });
    });

    const hydratedContrato = await getContratoWithRelations(contrato.id, user.contaId);

    if (!hydratedContrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado após regeneração' } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      contratoDTOSchema.parse(mapContratoRecordToDTO(hydratedContrato, { publicToken: tokenPublico })),
    );
  } catch (error) {
    console.error('[CONTRATO_REGENERAR]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao regenerar link do contrato' } },
      { status: 500 },
    );
  }
}
