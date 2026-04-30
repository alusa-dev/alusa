import { Prisma, type Plano } from '@prisma/client';
import { prisma } from '../prisma';
import {
  planoCreateSchema,
  planoFilterSchema,
  planoUpdateSchema,
  type PlanoCreateInput,
  type PlanoFilterInput,
  type PlanoUpdateInput,
} from './planos-schema';

export interface PlanoDTO {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  periodicidade: Plano['periodicidade'];
  valor: number;
  status: Plano['status'];
  createdAt: Date;
  updatedAt: Date;
}

function toPlanoDTO(plano: Plano): PlanoDTO {
  return {
    id: plano.id,
    contaId: plano.contaId,
    nome: plano.nome,
    descricao: plano.descricao ?? null,
    periodicidade: plano.periodicidade,
    valor: Number(plano.valor),
    status: plano.status,
    createdAt: plano.createdAt,
    updatedAt: plano.updatedAt,
  };
}

function ensureDecimal(valor: number): Prisma.Decimal {
  return new Prisma.Decimal(valor).toDecimalPlaces(2);
}

export async function listPlanos(input: PlanoFilterInput): Promise<PlanoDTO[]> {
  const parsed = planoFilterSchema.parse(input);
  const where: Prisma.PlanoWhereInput = {
    contaId: parsed.contaId,
  };
  if (parsed.status) {
    where.status = parsed.status;
  }
  if (parsed.search) {
    where.OR = [
      { nome: { contains: parsed.search, mode: 'insensitive' } },
      { descricao: { contains: parsed.search, mode: 'insensitive' } },
    ];
  }

  const planos = await prisma.plano.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return planos.map(toPlanoDTO);
}

export async function createPlano(input: PlanoCreateInput): Promise<PlanoDTO> {
  const parsed = planoCreateSchema.parse(input);

  const duplicated = await prisma.plano.findFirst({
    where: { contaId: parsed.contaId, nome: parsed.nome },
  });
  if (duplicated) {
    throw new Error('Já existe um plano com este nome nesta conta.');
  }

  const plano = await prisma.plano.create({
    data: {
      contaId: parsed.contaId,
      nome: parsed.nome,
      descricao: parsed.descricao,
      periodicidade: parsed.periodicidade,
      valor: ensureDecimal(parsed.valor),
      status: parsed.status ?? 'ATIVO',
    },
  });

  return toPlanoDTO(plano);
}

export async function updatePlano(input: PlanoUpdateInput): Promise<PlanoDTO> {
  const parsed = planoUpdateSchema.parse(input);

  const current = await prisma.plano.findFirst({
    where: { id: parsed.id, contaId: parsed.contaId },
  });
  if (!current) throw new Error('Plano não encontrado.');

  if (parsed.nome && parsed.nome !== current.nome) {
    const duplicated = await prisma.plano.findFirst({
      where: {
        contaId: parsed.contaId,
        nome: parsed.nome,
        id: { not: parsed.id },
      },
    });
    if (duplicated) {
      throw new Error('Já existe um plano com este nome nesta conta.');
    }
  }

  const data: Prisma.PlanoUpdateInput = {};

  if (parsed.nome !== undefined) data.nome = parsed.nome;
  if (parsed.descricao !== undefined) data.descricao = parsed.descricao;
  if (parsed.periodicidade !== undefined) data.periodicidade = parsed.periodicidade;
  if (parsed.valor !== undefined) data.valor = ensureDecimal(parsed.valor);
  if (parsed.status !== undefined) data.status = parsed.status;

  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const result = await prisma.plano.updateMany({
    where: { id: parsed.id, contaId: parsed.contaId },
    data,
  });
  if (result.count === 0) {
    throw new Error('Plano não encontrado.');
  }
  // Retornar registro atualizado
  const updated = await prisma.plano.findFirst({ where: { id: parsed.id, contaId: parsed.contaId } });
  if (!updated) throw new Error('Plano não encontrado.');

  return toPlanoDTO(updated);
}

export async function deletePlano(id: string, contaId: string): Promise<PlanoDTO> {
  const plano = await prisma.plano.findFirst({ where: { id, contaId } });
  if (!plano) throw new Error('Plano não encontrado.');
  // MULTI-TENANT: usar deleteMany para operação atômica com contaId
  const result = await prisma.plano.deleteMany({ where: { id, contaId } });
  if (result.count === 0) {
    throw new Error('Plano não encontrado.');
  }
  return toPlanoDTO(plano);
}
