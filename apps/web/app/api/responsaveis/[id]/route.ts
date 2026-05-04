import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import {
  responsavelDetailDTOSchema,
  updateResponsavelInputDTOSchema,
} from '@/features/responsaveis/dtos';
import {
  mapResponsavelRecordToDetailDTO,
  mapUpdateResponsavelDTOToData,
} from '@/features/responsaveis/mappers';

export const dynamic = 'force-dynamic';

const responsavelDetailSelect = {
  id: true,
  nome: true,
  cpf: true,
  email: true,
  telefone: true,
  financeiro: true,
  asaasCustomerId: true,
  usuarioId: true,
  enderecoCep: true,
  enderecoLogradouro: true,
  enderecoNumero: true,
  enderecoComplemento: true,
  enderecoBairro: true,
  enderecoCidade: true,
  enderecoUf: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      alunos: true,
      matriculasFinanceiras: true,
      sales: true,
    },
  },
} as const;

function getContaId(session: Awaited<ReturnType<typeof getServerSession>>) {
  return (session as { user?: { contaId?: string } })?.user?.contaId ?? null;
}

type IdParams = Promise<{ id: string }> | { id: string };

async function resolveResponsavelId(params: IdParams) {
  const { id } = await Promise.resolve(params);
  return typeof id === 'string' ? id : '';
}

export async function GET(_req: NextRequest, context: { params: IdParams }) {
  try {
    const id = await resolveResponsavelId(context.params);
    if (!id) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const contaId = getContaId(session);

    if (!contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id, contaId },
      select: responsavelDetailSelect,
    });

    if (!responsavel) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const dto = responsavelDetailDTOSchema.parse(mapResponsavelRecordToDetailDTO(responsavel));
    return NextResponse.json(dto);
  } catch (error) {
    console.error('[GET /api/responsaveis/[id]]', error);
    return NextResponse.json({ error: 'Erro ao buscar responsável' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: IdParams }) {
  try {
    const id = await resolveResponsavelId(context.params);
    if (!id) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const contaId = getContaId(session);

    if (!contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const raw = await req.json().catch(() => null);
    const validation = updateResponsavelInputDTOSchema.safeParse(raw);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Dados inválidos',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const atual = await prisma.responsavel.findFirst({
      where: { id, contaId },
      select: { id: true },
    });

    if (!atual) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const data = mapUpdateResponsavelDTOToData(validation.data);
    const cpf = typeof data.cpf === 'string' ? data.cpf : undefined;
    const email = typeof data.email === 'string' ? data.email : undefined;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Informe ao menos um campo válido para atualizar.' },
        { status: 400 },
      );
    }

    if (cpf || email) {
      const existente = await prisma.responsavel.findFirst({
        where: {
          contaId,
          id: { not: params.id },
          OR: [...(cpf ? [{ cpf }] : []), ...(email ? [{ email }] : [])],
        },
        select: { cpf: true, email: true },
      });

      if (existente) {
        if (cpf && existente.cpf === cpf) {
          return NextResponse.json({ error: 'CPF já cadastrado nesta conta' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Email já cadastrado nesta conta' }, { status: 409 });
      }
    }

    const responsavel = await prisma.responsavel.update({
      where: { id },
      data,
      select: responsavelDetailSelect,
    });

    const dto = responsavelDetailDTOSchema.parse(mapResponsavelRecordToDetailDTO(responsavel));
    return NextResponse.json(dto);
  } catch (error) {
    console.error('[PATCH /api/responsaveis/[id]]', error);
    return NextResponse.json({ error: 'Erro ao atualizar responsável' }, { status: 500 });
  }
}
