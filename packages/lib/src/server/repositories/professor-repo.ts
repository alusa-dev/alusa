/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '../../prisma';

export type ProfessorListParams = {
  contaId: string;
  page: number;
  pageSize: number;
  search?: string;
};

export type ProfessorRecord = {
  id: string;
  contaId: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  bio: string | null;
  status: 'ATIVO' | 'INATIVO' | string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateRepoInput = {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  bio?: string | null;
  status?: 'ATIVO' | 'INATIVO' | string;
};

export type UpdateRepoInput = Partial<CreateRepoInput>;

export async function list({ contaId, page, pageSize, search }: ProfessorListParams) {
  const where: any = {
    contaId,
    ...(search
      ? {
          OR: [
            { nome: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.professor.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }) as unknown as Promise<ProfessorRecord[]>,
    prisma.professor.count({ where: where as any }),
  ]);

  return { items, total, page, pageSize };
}

export async function getById(id: string, contaId: string): Promise<ProfessorRecord | null> {
  return prisma.professor.findFirst({
    where: { id, contaId } as any,
  }) as unknown as Promise<ProfessorRecord | null>;
}

export async function create(contaId: string, data: CreateRepoInput): Promise<ProfessorRecord> {
  const toCreate = {
    contaId,
    nome: data.nome,
    email: data.email ?? null,
    telefone: data.telefone ?? null,
    bio: data.bio ?? null,
    status: data.status ?? 'ATIVO',
  };
  return (await prisma.professor.create({ data: toCreate as any })) as unknown as ProfessorRecord;
}

export async function update(
  id: string,
  _contaId: string,
  data: UpdateRepoInput,
): Promise<ProfessorRecord> {
  const toUpdate = {
    ...(data.nome !== undefined ? { nome: data.nome } : {}),
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.telefone !== undefined ? { telefone: data.telefone } : {}),
    ...(data.bio !== undefined ? { bio: data.bio } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  };
  return (await prisma.professor.update({
    where: { id },
    data: toUpdate as any,
  })) as unknown as ProfessorRecord;
}

export async function remove(id: string): Promise<ProfessorRecord> {
  // soft-delete: apenas marca status = INATIVO e retorna o registro
  return (await prisma.professor.update({
    where: { id },
    data: { status: 'INATIVO' } as any,
  })) as unknown as ProfessorRecord;
}
