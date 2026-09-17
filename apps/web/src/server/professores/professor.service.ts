import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

const professorListSelect = {
  id: true,
  nome: true,
  cpf: true,
  dataNasc: true,
  email: true,
  telefoneCel: true,
  telefoneFixo: true,
  cep: true,
  logradouro: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  uf: true,
  formacao: true,
  especialidades: true,
  dataAdmissao: true,
  statusContratual: true,
  cargaHoraria: true,
  miniBio: true,
  foto: true,
  status: true,
  createdAt: true,
} as const;

export function getProfessor(contaId: string, professorId: string) {
  return prisma.professor.findFirst({ where: { id: professorId, contaId } });
}

export async function listProfessores(input: {
  contaId: string;
  search?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ProfessorWhereInput = {
    contaId: input.contaId,
    ...(input.status ? { status: input.status as Prisma.ProfessorWhereInput['status'] } : {}),
    ...(input.search
      ? {
          OR: [
            { nome: { contains: input.search, mode: 'insensitive' } },
            { email: { contains: input.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.professor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: professorListSelect,
    }),
    prisma.professor.count({ where }),
  ]);

  return { data, total };
}

export async function createProfessor(input: {
  contaId: string;
  data: Prisma.ProfessorCreateInput;
}) {
  return prisma.professor.create({ data: input.data });
}

export async function syncProfessoresFromColaboradores(contaId: string) {
  try {
    const [colaboradores, professoresExistentes] = await Promise.all([
      prisma.colaborador.findMany({
        where: { contaId, cargo: 'PROFESSOR' },
        select: {
          id: true,
          nome: true,
          cpf: true,
          dataNasc: true,
          email: true,
          telefone1: true,
          status: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
          especialidade: true,
          foto: true,
        },
      }),
      prisma.professor.findMany({
        where: { contaId },
        select: { id: true, cpf: true, email: true },
      }),
    ]);

    const byCpf = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const professor of professoresExistentes) {
      if (professor.cpf) byCpf.set(professor.cpf, professor.id);
      if (professor.email) byEmail.set(professor.email.toLowerCase(), professor.id);
    }

    for (const colaborador of colaboradores) {
      const cpf = colaborador.cpf ?? undefined;
      const email = colaborador.email ? colaborador.email.toLowerCase() : undefined;
      const telefone = colaborador.telefone1 ?? undefined;
      const exists = (cpf && byCpf.get(cpf)) || (email && byEmail.get(email)) || null;
      if (exists || !cpf || !colaborador.dataNasc || !email || !telefone) continue;

      const created = await prisma.professor.create({
        data: {
          contaId,
          nome: colaborador.nome,
          cpf,
          dataNasc: colaborador.dataNasc,
          email,
          telefoneCel: telefone,
          telefoneFixo: null,
          cep: colaborador.enderecoCep ?? null,
          logradouro: colaborador.enderecoLogradouro ?? null,
          numero: colaborador.enderecoNumero ?? null,
          complemento: colaborador.enderecoComplemento ?? null,
          bairro: colaborador.enderecoBairro ?? null,
          cidade: colaborador.enderecoCidade ?? null,
          uf: colaborador.enderecoUf ?? null,
          formacao: null,
          especialidades: colaborador.especialidade ? [colaborador.especialidade] : [],
          dataAdmissao: null,
          statusContratual: null,
          cargaHoraria: null,
          miniBio: null,
          foto: colaborador.foto ?? null,
          status: colaborador.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        },
      });
      byCpf.set(cpf, created.id);
      byEmail.set(email, created.id);
    }
  } catch (error) {
    console.error('[professor.service] sync colaboradores->professores falhou', error);
  }
}

export async function updateProfessor(input: {
  contaId: string;
  professorId: string;
  data: Prisma.ProfessorUpdateManyMutationInput;
}) {
  const result = await prisma.professor.updateMany({
    where: { id: input.professorId, contaId: input.contaId },
    data: input.data,
  });
  if (result.count === 0) return null;
  return getProfessor(input.contaId, input.professorId);
}
