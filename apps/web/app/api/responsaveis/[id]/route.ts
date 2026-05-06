import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ChargeStatus, type Prisma } from '@prisma/client';

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
import { resolveResponsavelRouteId } from '../_lib/resolve-responsavel-route-id';

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
} as const;

type ResponsavelDetailRecord = Prisma.ResponsavelGetPayload<{
  select: typeof responsavelDetailSelect;
}>;

function getContaId(session: Awaited<ReturnType<typeof getServerSession>>) {
  return (session as { user?: { contaId?: string } })?.user?.contaId ?? null;
}

type IdParams = Promise<{ id: string }> | { id: string };

async function resolveResponsavelId(params: IdParams) {
  const { id } = await Promise.resolve(params);
  return typeof id === 'string' ? id : '';
}

async function getResponsavelMetrics(id: string, contaId: string) {
  const [alunos, matriculasFinanceiras, vendas] = await Promise.all([
    prisma.alunoResponsavel.count({ where: { responsavelId: id } }),
    prisma.matricula.count({
      where: {
        responsavelFinanceiroId: id,
        aluno: { contaId },
      },
    }),
    prisma.sale.count({ where: { responsavelId: id, contaId } }),
  ]);

  return { alunos, matriculasFinanceiras, sales: vendas };
}

async function buildResponsavelDetailDTO(
  responsavel: ResponsavelDetailRecord | null,
  contaId: string,
) {
  if (!responsavel) return null;
  const metrics = await getResponsavelMetrics(responsavel.id, contaId);
  return responsavelDetailDTOSchema.parse(
    mapResponsavelRecordToDetailDTO({
      ...responsavel,
      createdAt: null,
      updatedAt: null,
      _count: metrics,
    }),
  );
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

    const responsavelId = await resolveResponsavelRouteId(id, contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: responsavelId, contaId },
      select: responsavelDetailSelect,
    });

    if (!responsavel) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const dto = await buildResponsavelDetailDTO(responsavel, contaId);
    if (!dto) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

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

    const responsavelId = await resolveResponsavelRouteId(id, contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const atual = await prisma.responsavel.findFirst({
      where: { id: responsavelId, contaId },
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
          id: { not: responsavelId },
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
      where: { id: responsavelId },
      data: data as Prisma.ResponsavelUpdateInput,
      select: responsavelDetailSelect,
    });

    const dto = await buildResponsavelDetailDTO(responsavel, contaId);
    if (!dto) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    return NextResponse.json(dto);
  } catch (error) {
    console.error('[PATCH /api/responsaveis/[id]]', error);
    return NextResponse.json({ error: 'Erro ao atualizar responsável' }, { status: 500 });
  }
}

const PENDING_CHARGE_STATUSES: ChargeStatus[] = [
  ChargeStatus.CREATED,
  ChargeStatus.PENDING_SYNC,
  ChargeStatus.OPEN,
  ChargeStatus.OVERDUE,
];

const FAMILY_BILLING_IN_FLIGHT = ['PENDENTE', 'PROCESSANDO', 'ATIVO', 'PARCIAL'] as const;

export async function DELETE(_req: NextRequest, context: { params: IdParams }) {
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

    const responsavelId = await resolveResponsavelRouteId(id, contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const existente = await prisma.responsavel.findFirst({
      where: { id: responsavelId, contaId },
      select: { id: true },
    });

    if (!existente) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const [
      customers,
      familiasIds,
      rematriculasIds,
      alunosVinculados,
      matriculasFinanceirasAtivas,
      matriculaFamiliarPendente,
      rematriculaFamiliarPendente,
      vendasPendentes,
    ] = await Promise.all([
      prisma.customer.findMany({
        where: {
          contaId,
          payerType: 'RESPONSAVEL',
          payerId: responsavelId,
        },
        select: { id: true },
      }),
      prisma.matriculaFamiliar.findMany({
        where: { contaId, responsavelId },
        select: { id: true },
      }),
      prisma.rematriculaFamiliar.findMany({
        where: { contaId, responsavelId },
        select: { id: true },
      }),
      prisma.alunoResponsavel.count({ where: { responsavelId } }),
      prisma.matricula.count({
        where: {
          responsavelFinanceiroId: responsavelId,
          aluno: { contaId },
          status: { notIn: ['CANCELADA', 'RECUSADA'] },
        },
      }),
      prisma.matriculaFamiliar.count({
        where: {
          contaId,
          responsavelId,
          status: { in: [...FAMILY_BILLING_IN_FLIGHT] },
        },
      }),
      prisma.rematriculaFamiliar.count({
        where: {
          contaId,
          responsavelId,
          status: { in: [...FAMILY_BILLING_IN_FLIGHT] },
        },
      }),
      prisma.sale.count({
        where: {
          contaId,
          responsavelId,
          status: { in: ['PENDENTE', 'VINCULADA_MENSALIDADE'] },
        },
      }),
    ]);

    const familyGroupIds = [
      ...familiasIds.map((row) => row.id),
      ...rematriculasIds.map((row) => row.id),
    ];

    const chargeOr: Prisma.ChargeWhereInput[] = [
      ...(customers.length > 0
        ? [{ customerId: { in: customers.map((c) => c.id) } } satisfies Prisma.ChargeWhereInput]
        : []),
      ...(familyGroupIds.length > 0
        ? [{ familyGroupId: { in: familyGroupIds } } satisfies Prisma.ChargeWhereInput]
        : []),
    ];

    const cobrancasPendentes =
      chargeOr.length === 0
        ? 0
        : await prisma.charge.count({
            where: {
              contaId,
              OR: chargeOr,
              status: { in: PENDING_CHARGE_STATUSES },
            },
          });

    const conflitos: string[] = [];
    if (alunosVinculados > 0) {
      conflitos.push('existem alunos vinculados a este responsável');
    }
    if (cobrancasPendentes > 0) {
      conflitos.push('existem cobranças em aberto ou pendentes vinculadas a este responsável');
    }
    if (matriculasFinanceirasAtivas > 0) {
      conflitos.push(
        'este responsável é o financeiro de matrículas que ainda não estão canceladas ou recusadas',
      );
    }
    if (matriculaFamiliarPendente > 0 || rematriculaFamiliarPendente > 0) {
      conflitos.push('existem lotes de matrícula ou rematrícula familiar em andamento');
    }
    if (vendasPendentes > 0) {
      conflitos.push('existem vendas pendentes vinculadas a este responsável');
    }

    if (conflitos.length > 0) {
      return NextResponse.json(
        {
          error: `Não é possível excluir: ${conflitos.join('; ')}.`,
          code: 'EXCLUSAO_RESPONSAVEL_CONFLITO',
          conflitos,
        },
        { status: 409 },
      );
    }

    await prisma.responsavel.delete({
      where: { id: responsavelId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/responsaveis/[id]]', error);
    return NextResponse.json({ error: 'Erro ao excluir responsável' }, { status: 500 });
  }
}
