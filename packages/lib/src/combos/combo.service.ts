import { Prisma, PeriodicidadePlano } from '@prisma/client';
import { prisma } from '../prisma';
import {
  comboCreateSchema,
  comboUpdateSchema,
  comboFilterSchema,
  type ComboCreateInput,
  type ComboUpdateInput,
  type ComboFilterInput,
  type ComboDTO,
} from './combo.schema';

function toDecimal(n: number) {
  return new Prisma.Decimal(n).toDecimalPlaces(2);
}

interface RawCombo {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  valor: Prisma.Decimal | number;
  periodicidade: PeriodicidadePlano;
  status: string;
  vagasLimite: number | null;
  createdAt: Date;
  updatedAt: Date;
  turmas?: { turma: { id: string; nome: string } }[];
}

function toComboDTO(combo: RawCombo): ComboDTO {
  return {
    id: combo.id,
    contaId: combo.contaId,
    nome: combo.nome,
    descricao: combo.descricao ?? null,
    valor: Number(combo.valor),
    periodicidade: combo.periodicidade,
    status: combo.status,
    vagasLimite: combo.vagasLimite ?? null,
    turmas: (combo.turmas || []).map((ct: { turma: { id: string; nome: string } }) => ({
      id: ct.turma.id,
      nome: ct.turma.nome,
    })),
    createdAt: combo.createdAt,
    updatedAt: combo.updatedAt,
  };
}

export async function listCombos(input: ComboFilterInput): Promise<ComboDTO[]> {
  const parsed = comboFilterSchema.parse(input);
  const where: Prisma.ComboWhereInput = { contaId: parsed.contaId };
  if (parsed.status) where.status = parsed.status;
  if (parsed.search) {
    where.OR = [
      { nome: { contains: parsed.search, mode: 'insensitive' } },
      { descricao: { contains: parsed.search, mode: 'insensitive' } },
    ];
  }
  const combos = await prisma.combo.findMany({
    where,
    include: { turmas: { include: { turma: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return combos.map(toComboDTO);
}

export async function createCombo(input: ComboCreateInput): Promise<ComboDTO> {
  const parsed = comboCreateSchema.parse(input);
  const exists = await prisma.combo.findFirst({
    where: { contaId: parsed.contaId, nome: parsed.nome },
  });
  if (exists) throw new Error('Já existe um combo com este nome.');

  const combo = await prisma.combo.create({
    data: {
      contaId: parsed.contaId,
      nome: parsed.nome,
      descricao: parsed.descricao,
      valor: toDecimal(parsed.valor),
      periodicidade: parsed.periodicidade as PeriodicidadePlano,
      status: parsed.status ?? 'ATIVO',
      vagasLimite: parsed.vagasLimite,
      turmas:
        parsed.turmaIds && parsed.turmaIds.length
          ? {
            createMany: {
              data: parsed.turmaIds.map((tid: string) => ({
                contaId: parsed.contaId,
                turmaId: tid,
              })),
            },
          }
          : undefined,
    },
    include: { turmas: { include: { turma: true } } },
  });
  return toComboDTO(combo);
}

export async function updateCombo(input: ComboUpdateInput): Promise<ComboDTO> {
  const parsed = comboUpdateSchema.parse(input);
  const current = await prisma.combo.findFirst({
    where: { id: parsed.id, contaId: parsed.contaId },
    include: { turmas: true },
  });
  if (!current) throw new Error('Combo não encontrado.');

  // Nome duplicado
  if (parsed.nome && parsed.nome !== current.nome) {
    const dup = await prisma.combo.findFirst({
      where: { contaId: parsed.contaId, nome: parsed.nome, id: { not: parsed.id } },
    });
    if (dup) throw new Error('Já existe um combo com este nome.');
  }

  const data: Prisma.ComboUpdateInput = {};
  if (parsed.nome !== undefined) data.nome = parsed.nome;
  if (parsed.descricao !== undefined) data.descricao = parsed.descricao;
  if (parsed.valor !== undefined) data.valor = toDecimal(parsed.valor);
  if (parsed.periodicidade !== undefined) data.periodicidade = parsed.periodicidade as PeriodicidadePlano;
  if (parsed.status !== undefined) data.status = parsed.status;
  if (parsed.vagasLimite !== undefined) data.vagasLimite = parsed.vagasLimite;

  const turmasUpdate = parsed.turmaIds
    ? {
      deleteMany: {},
      createMany: {
        data: parsed.turmaIds.map((tid: string) => ({
          contaId: parsed.contaId,
          turmaId: tid,
        })),
      },
    }
    : undefined;

  // MULTI-TENANT: usar atomicidade. Se tem update de relations, precisamos garantir owner via where na relations ou transação.
  // Como Prisma não suporta updateMany com nested writes, usamos transação com verify.
  // Já verificamos 'current' com contaId, então dentro da transação asseguramos isolamento.
  const combo = await prisma.$transaction(async (tx) => {
    // Re-verificar para evitar race conditions ou bypass
    const verify = await tx.combo.findFirst({ where: { id: parsed.id, contaId: parsed.contaId } });
    if (!verify) throw new Error('Combo não encontrado.');

    return tx.combo.update({
      where: { id: parsed.id },
      data: { ...data, turmas: turmasUpdate },
      include: { turmas: { include: { turma: true } } },
    });
  });
  return toComboDTO(combo);
}

export async function deleteCombo(id: string, contaId: string): Promise<ComboDTO> {
  const combo = await prisma.combo.findFirst({
    where: { id, contaId },
    include: { turmas: { include: { turma: true } } },
  });
  if (!combo) throw new Error('Combo não encontrado.');
  // MULTI-TENANT: usar deleteMany para atomicidade
  await prisma.combo.deleteMany({ where: { id, contaId } });
  return toComboDTO(combo);
}
