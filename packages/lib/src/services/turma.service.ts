import type { Turma } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { turmaSchema } from '../schemas/turma.schema';
import type { TurmaCreateInput, TurmaUpdateInput } from '../schemas/turma.schema';
import { buildSeatOccupancyWhereClause } from './matricula-occupancy';

function parseHora(h: string): number {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
}

interface ValidarConflitoParams {
  salaId: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
  contaId: string;
  ignoreId?: string;
}

async function validarConflitosSala(params: ValidarConflitoParams): Promise<void> {
  const { salaId, diasSemana, horaInicio, horaFim, contaId, ignoreId } = params;
  const ini = parseHora(horaInicio);
  const fim = parseHora(horaFim);
  if (ini >= fim) throw new Error('Hora início deve ser antes da hora fim');
  const turmasMesmoDia = await prisma.turma.findMany({
    where: {
      contaId,
      salaId,
      id: ignoreId ? { not: ignoreId } : undefined,
      diasSemana: { hasSome: diasSemana },
      status: 'ATIVO',
    },
    select: { id: true, nome: true, horaInicio: true, horaFim: true },
  });
  for (const t of turmasMesmoDia) {
    const tIni = parseHora(t.horaInicio);
    const tFim = parseHora(t.horaFim);
    if (ini < tFim && fim > tIni)
      throw new Error(`Conflito de horário com a turma "${t.nome}" (${t.horaInicio}-${t.horaFim})`);
  }
}

async function ensureProfessorRecords(
  contaId: string,
  colaboradorIds: string[],
): Promise<string[]> {
  if (!colaboradorIds.length) return [];
  const colaboradores = await prisma.colaborador.findMany({
    where: { contaId, id: { in: colaboradorIds }, cargo: 'PROFESSOR' },
    select: {
      id: true,
      nome: true,
      nomeSocial: true,
      foto: true,
      cpf: true,
      dataNasc: true,
      email: true,
      telefone1: true,
      status: true,
      especialidade: true,
      enderecoCep: true,
      enderecoLogradouro: true,
      enderecoNumero: true,
      enderecoComplemento: true,
      enderecoBairro: true,
      enderecoCidade: true,
      enderecoUf: true,
    },
  });
  const encontrados = new Map(colaboradores.map((c) => [c.id, c]));
  const faltantes = colaboradorIds.filter((id) => !encontrados.has(id));
  if (faltantes.length) {
    throw new Error('Professor(es) inválido(s) ou não pertencem à conta');
  }

  const professorIds: string[] = [];
  for (const colab of colaboradores) {
    let professor = await prisma.professor.findUnique({ where: { id: colab.id } });
    if (!professor) {
      const uniqueFilters: Prisma.ProfessorWhereInput[] = [];
      if (colab.cpf) uniqueFilters.push({ cpf: colab.cpf });
      if (colab.email) uniqueFilters.push({ email: colab.email });
      if (uniqueFilters.length) {
        professor = await prisma.professor.findFirst({ where: { contaId, OR: uniqueFilters } });
      }
    }
    const especialidades = (colab.especialidade || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const baseData = {
      nome: colab.nome,
      cpf: colab.cpf ?? undefined,
      dataNasc: colab.dataNasc ?? undefined,
      email: colab.email ?? undefined,
      telefoneCel: colab.telefone1 ?? undefined,
      status: colab.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      foto: colab.foto ?? undefined,
      especialidades,
      cep: colab.enderecoCep ?? undefined,
      logradouro: colab.enderecoLogradouro ?? undefined,
      numero: colab.enderecoNumero ?? undefined,
      complemento: colab.enderecoComplemento ?? undefined,
      bairro: colab.enderecoBairro ?? undefined,
      cidade: colab.enderecoCidade ?? undefined,
      uf: colab.enderecoUf ?? undefined,
    } as {
      nome: string;
      cpf?: string;
      dataNasc?: Date;
      email?: string;
      telefoneCel?: string;
      status: 'ATIVO' | 'INATIVO';
      foto?: string;
      especialidades: string[];
      cep?: string;
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      cidade?: string;
      uf?: string;
    };

    if (!professor) {
      if (!baseData.cpf || !baseData.dataNasc || !baseData.email || !baseData.telefoneCel) {
        throw new Error(
          `Professor "${colab.nome}" está com dados incompletos (CPF, data de nascimento, e-mail e telefone são obrigatórios).`,
        );
      }
      try {
        professor = await prisma.professor.create({
          data: {
            id: colab.id,
            contaId,
            nome: baseData.nome,
            cpf: baseData.cpf,
            dataNasc: baseData.dataNasc,
            email: baseData.email,
            telefoneCel: baseData.telefoneCel,
            status: baseData.status,
            foto: baseData.foto,
            especialidades: baseData.especialidades,
            cep: baseData.cep,
            logradouro: baseData.logradouro,
            numero: baseData.numero,
            complemento: baseData.complemento,
            bairro: baseData.bairro,
            cidade: baseData.cidade,
            uf: baseData.uf,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const uniqueFilters: Prisma.ProfessorWhereInput[] = [];
          if (baseData.cpf) uniqueFilters.push({ cpf: baseData.cpf });
          if (baseData.email) uniqueFilters.push({ email: baseData.email });
          const existente = uniqueFilters.length
            ? await prisma.professor.findFirst({ where: { contaId, OR: uniqueFilters } })
            : null;
          if (existente) {
            professor = existente;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } else if (professor.contaId !== contaId) {
      throw new Error('Professor pertence a outra conta');
    } else {
      await prisma.professor.update({
        where: { id: professor.id },
        data: {
          nome: baseData.nome,
          cpf: baseData.cpf ?? undefined,
          dataNasc: baseData.dataNasc ?? undefined,
          email: baseData.email ?? undefined,
          telefoneCel: baseData.telefoneCel ?? undefined,
          status: baseData.status,
          foto: baseData.foto ?? null,
          especialidades: baseData.especialidades,
          cep: baseData.cep ?? null,
          logradouro: baseData.logradouro ?? null,
          numero: baseData.numero ?? null,
          complemento: baseData.complemento ?? null,
          bairro: baseData.bairro ?? null,
          cidade: baseData.cidade ?? null,
          uf: baseData.uf ?? null,
        },
      });
    }
    professorIds.push(professor.id);
  }
  return Array.from(new Set(professorIds));
}

export async function createTurma(input: TurmaCreateInput): Promise<Turma> {
  // Logs de diagnóstico (podem ser removidos em produção)
  console.log('[turma.service] createTurma init', {
    contaId: input.contaId,
    nome: input.nome,
    modalidadeId: input.modalidadeId,
    salaId: input.salaId,
    diasSemana: input.diasSemana,
  });
  const data = turmaSchema.parse(input);
  const exists = await prisma.turma.findFirst({
    where: { contaId: input.contaId, nome: data.nome },
  });
  if (exists) throw new Error('Já existe uma turma com este nome nesta conta');
  const modalidade = await prisma.modalidade.findFirst({
    where: { id: data.modalidadeId, contaId: input.contaId },
  });
  if (!modalidade) console.warn('[turma.service] modalidade não encontrada', data.modalidadeId);
  if (!modalidade) throw new Error('Modalidade não encontrada');
  const sala = await prisma.sala.findFirst({ where: { id: data.salaId, contaId: input.contaId } });
  if (!sala) console.warn('[turma.service] sala não encontrada', data.salaId);
  if (!sala) throw new Error('Sala não encontrada');
  await validarConflitosSala({
    salaId: data.salaId,
    diasSemana: data.diasSemana,
    horaInicio: data.horaInicio,
    horaFim: data.horaFim,
    contaId: input.contaId,
  });
  const professorIds = await ensureProfessorRecords(input.contaId, data.professoresIds ?? []);
  console.log('[turma.service] criando turma no banco');
  const turma = await prisma.turma.create({
    data: {
      contaId: input.contaId,
      nome: data.nome,
      modalidadeId: data.modalidadeId,
      salaId: data.salaId,
      diasSemana: data.diasSemana,
      horaInicio: data.horaInicio,
      horaFim: data.horaFim,
      idadeMin: data.idadeMin,
      idadeMax: data.idadeMax,
      capacidade: data.capacidade,
      status: data.status,
      observacao: data.observacao,
    },
  });
  console.log('[turma.service] turma criada', turma.id);
  if (professorIds.length) {
    await prisma.turmaProfessor.createMany({
      data: professorIds.map((profId) => ({ turmaId: turma.id, professorId: profId })),
      skipDuplicates: true,
    });
  }
  return turma;
}

export async function updateTurma(input: TurmaUpdateInput): Promise<Turma> {
  const current = await prisma.turma.findFirst({ where: { id: input.id, contaId: input.contaId } });
  if (!current) throw new Error('Turma não encontrada');
  const merged = { ...current, ...input } as TurmaCreateInput;
  const data = turmaSchema.parse(merged);
  if (input.nome && input.nome !== current.nome) {
    const dup = await prisma.turma.findFirst({
      where: { contaId: input.contaId, nome: input.nome, id: { not: input.id } },
    });
    if (dup) throw new Error('Já existe uma turma com este nome nesta conta');
  }
  await validarConflitosSala({
    salaId: data.salaId,
    diasSemana: data.diasSemana,
    horaInicio: data.horaInicio,
    horaFim: data.horaFim,
    contaId: input.contaId,
    ignoreId: current.id,
  });
  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const updateResult = await prisma.turma.updateMany({
    where: { id: input.id, contaId: input.contaId },
    data: {
      nome: data.nome,
      modalidadeId: data.modalidadeId,
      salaId: data.salaId,
      diasSemana: data.diasSemana,
      horaInicio: data.horaInicio,
      horaFim: data.horaFim,
      idadeMin: data.idadeMin,
      idadeMax: data.idadeMax,
      capacidade: data.capacidade,
      status: data.status,
      observacao: data.observacao,
    },
  });
  if (updateResult.count === 0) {
    throw new Error('Turma não encontrada');
  }
  // Buscar registro atualizado
  const turma = await prisma.turma.findFirst({ where: { id: input.id, contaId: input.contaId } });
  if (!turma) throw new Error('Turma não encontrada');
  if (input.professoresIds) {
    const professorIds = await ensureProfessorRecords(input.contaId, input.professoresIds);
    await prisma.turmaProfessor.deleteMany({ where: { turmaId: turma.id } });
    if (professorIds.length) {
      await prisma.turmaProfessor.createMany({
        data: professorIds.map((p) => ({ turmaId: turma.id, professorId: p })),
      });
    }
  }
  return turma;
}

export type TurmaListItem = Turma & { professoresCount?: number; vagasOcupadas?: number };

export function buildTurmaOccupancyMatriculaWhere(
  contaId: string,
  turmaIds: string[],
): Prisma.MatriculaWhereInput {
  return {
    AND: [
      buildSeatOccupancyWhereClause() as Prisma.MatriculaWhereInput,
      { aluno: { contaId } },
      {
        OR: [
          { turmaId: { in: turmaIds } },
          { matriculaTurmas: { some: { turmaId: { in: turmaIds } } } },
        ],
      },
    ],
  };
}

export async function listTurmas(
  contaId: string,
  opts?: { page?: number; pageSize?: number; q?: string; status?: string },
): Promise<{ data: TurmaListItem[]; page: number; pageSize: number; total: number }> {
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 20));
  const where: Record<string, unknown> = { contaId };
  if (opts?.q) where.nome = { contains: opts.q, mode: 'insensitive' };
  if (opts?.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.turma.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: {
          select: {
            professores: true,
          },
        },
      },
    }),
    prisma.turma.count({ where }),
  ]);
  const turmaIds = items.map((t) => t.id);

  const ocupacaoPorTurma = new Map<string, number>();

  if (turmaIds.length) {
    const matriculasQueOcupamVaga = await prisma.matricula.findMany({
      where: buildTurmaOccupancyMatriculaWhere(contaId, turmaIds),
      select: {
        id: true,
        turmaId: true,
        matriculaTurmas: {
          where: { turmaId: { in: turmaIds } },
          select: { turmaId: true },
        },
      },
    });

    for (const m of matriculasQueOcupamVaga) {
      const turmasDaMatricula = new Set<string>();
      if (m.turmaId) turmasDaMatricula.add(m.turmaId);
      m.matriculaTurmas.forEach((mt) => turmasDaMatricula.add(mt.turmaId));
      turmasDaMatricula.forEach((tid) => {
        ocupacaoPorTurma.set(tid, (ocupacaoPorTurma.get(tid) ?? 0) + 1);
      });
    }
  }

  const data = items.map((t) => {
    const professoresCount = (t as { _count?: { professores?: number } })._count?.professores || 0;
    const vagasOcupadas = ocupacaoPorTurma.get(t.id) ?? 0;
    const rest = t as unknown as Turma;
    return { ...rest, professoresCount, vagasOcupadas };
  });
  return { data, page, pageSize, total };
}

export async function deleteTurma(id: string, contaId: string): Promise<Turma> {
  const turma = await prisma.turma.findFirst({ where: { id, contaId } });
  if (!turma) throw new Error('Turma não encontrada');
  if (turma.status === 'INATIVO') return turma;
  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const result = await prisma.turma.updateMany({ where: { id, contaId }, data: { status: 'INATIVO' } });
  if (result.count === 0) {
    throw new Error('Turma não encontrada');
  }
  // Retornar registro atualizado
  const updated = await prisma.turma.findFirst({ where: { id, contaId } });
  if (!updated) throw new Error('Turma não encontrada');
  return updated;
}
