import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import {
  deleteContratoModeloResultDTOSchema,
  updateContratoModeloInputDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoModeloRecordToDTO } from '@/features/contratos/mappers';
import { generateContratoConsentimentoCodigo } from '@/features/contratos/consent-code';

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
        campos: { orderBy: { ordem: 'asc' } },
        consentimentos: { orderBy: { ordem: 'asc' }, include: { template: { select: { versao: true } } } },
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

    const { campos, consentimentos, ...modeloData } = body;
    const templateIds = [...new Set((consentimentos ?? []).flatMap((term) => term.templateId ? [term.templateId] : []))];
    const templates = templateIds.length
      ? await prisma.contratoConsentimentoTemplate.findMany({
          where: { id: { in: templateIds }, ativo: true, OR: [{ contaId: null }, { contaId: user.contaId }] },
          select: { id: true, versao: true },
        })
      : [];
    if (templates.length !== templateIds.length) {
      return NextResponse.json({ error: { message: 'Template de consentimento inválido' } }, { status: 400 });
    }
    const templateVersions = new Map(templates.map((template) => [template.id, template.versao]));
    const modelo = await prisma.$transaction(async (tx) => {
      await tx.contratoModelo.update({
        where: { id },
        data: modeloData,
      });

      if (campos !== undefined) {
        await tx.contratoModeloCampo.deleteMany({
          where: { modeloId: id, contaId: user.contaId },
        });

        await tx.contratoModeloCampo.createMany({
          data: campos.map((campo) => ({
            contaId: user.contaId,
            modeloId: id,
            ...campo,
          })),
        });
      }

      if (consentimentos !== undefined) {
        await tx.contratoModeloConsentimento.deleteMany({
          where: { modeloId: id, contaId: user.contaId },
        });

        if (consentimentos.length) {
          await tx.contratoModeloConsentimento.createMany({
            data: consentimentos.map((consentimento, index) => ({
              contaId: user.contaId,
              modeloId: id,
              codigo: generateContratoConsentimentoCodigo(index),
              templateVersao: consentimento.templateId ? templateVersions.get(consentimento.templateId) : null,
              ...consentimento,
            })),
          });
        }
      }

      return tx.contratoModelo.findFirstOrThrow({
        where: { id, contaId: user.contaId },
        include: {
          _count: { select: { contratos: true } },
          campos: { orderBy: { ordem: 'asc' } },
          consentimentos: { orderBy: { ordem: 'asc' }, include: { template: { select: { versao: true } } } },
        },
      });
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
