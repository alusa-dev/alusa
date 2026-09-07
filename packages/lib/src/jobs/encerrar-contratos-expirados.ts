import { prisma } from '../prisma';
import { createContractExpiredNotification } from '../notifications/domain-notifications';
import { StatusContrato, StatusMatricula } from '@prisma/client';
import {
  addAcademicDays,
  getAcademicDateBoundsForInstant,
  getAcademicDateBoundsForStoredDate,
  getAcademicDateDifference,
} from '../utils/date-only';

export interface AcademicJobOptions {
  /** Instante único usado pela operação, facilitando consistência e testes. */
  now?: Date;
  /** Timezone acadêmico da Conta; quando omitido, é resolvido pela Conta. */
  timeZone?: string;
}

export interface EncerrarContratosResult {
  processados: number;
  atualizados: number;
  erros: Array<{ matriculaId: string; erro: string }>;
  dataExecucao: Date;
}

/**
 * Job que encerra automaticamente matrículas cujo período contratual terminou.
 *
 * Ações realizadas:
 * 1. Atualiza statusContrato para ENCERRADO
 * 2. Define dataFim = dataFimContrato (se dataFim for null)
 * 3. Cria log de auditoria
 *
 * @param contaId - OBRIGATÓRIO para garantir isolamento multi-tenant
 */
export async function encerrarContratosExpirados(
  contaId: string,
  options: AcademicJobOptions = {},
): Promise<EncerrarContratosResult> {
  if (!contaId) {
    throw new Error('contaId é obrigatório para garantir isolamento multi-tenant');
  }

  const now = options.now ?? new Date();
  const conta = options.timeZone
    ? null
    : await prisma.conta.findUnique({
        where: { id: contaId },
        select: { timezone: true },
      });
  const timeZone = options.timeZone ?? conta?.timezone;
  const academicDay = getAcademicDateBoundsForInstant(now, timeZone);

  const where = {
    contaId,
    status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
    // dataFimContrato representa uma data civil armazenada em UTC. Um
    // contrato só expira quando o calendário da Conta já avançou para o dia
    // seguinte, por isso o limite é o início do dia acadêmico atual.
    dataFimContrato: { lt: academicDay.start },
    NOT: [
      {
        rematriculaItensOrigem: {
          some: {
            decision: 'RENEW' as const,
            processo: { status: { not: 'CANCELLED' as const } },
          },
        },
      },
      {
        rematriculasDerivadas: {
          some: {
            status: {
              in: [
                StatusMatricula.PENDENTE_TAXA,
                StatusMatricula.AGUARDANDO_CONFIRMACAO,
                StatusMatricula.ATIVA,
                StatusMatricula.PAUSADA,
              ],
            },
          },
        },
      },
    ],
  };

  const matriculasExpiradas = await prisma.matricula.findMany({
    where,
    select: {
      id: true,
      dataFimContrato: true,
      dataFim: true,
      alunoId: true,
      aluno: { select: { nome: true, contaId: true } },
    },
  });

  const result: EncerrarContratosResult = {
    processados: matriculasExpiradas.length,
    atualizados: 0,
    erros: [],
    dataExecucao: now,
  };

  for (const matricula of matriculasExpiradas) {
    try {
      await prisma.$transaction(async (tx) => {
        const update = await tx.matricula.updateMany({
          where: { id: matricula.id, contaId },
          data: {
            statusContrato: StatusContrato.EXPIRADO,
            status: StatusMatricula.ENCERRADA,
            dataFim: matricula.dataFim ?? matricula.dataFimContrato,
          },
        });

        if (update.count !== 1) {
          throw new Error('Matrícula não encontrada no tenant durante o encerramento.');
        }

        await tx.matriculaLog.create({
          data: {
            matriculaId: matricula.id,
            action: 'CONTRATO_ENCERRADO_AUTOMATICO',
            metadata: {
              dataFimContrato: matricula.dataFimContrato.toISOString(),
              dataExecucaoJob: result.dataExecucao.toISOString(),
              motivo: 'Job automático de encerramento de contratos expirados',
            },
          },
        });
      });

      result.atualizados++;

      void createContractExpiredNotification({
        contaId,
        matriculaId: matricula.id,
        alunoNome: matricula.aluno.nome ?? 'Aluno',
        dataFimContrato: matricula.dataFimContrato,
      });
    } catch (error) {
      result.erros.push({
        matriculaId: matricula.id,
        erro: (error as Error).message,
      });
    }
  }

  return result;
}

/**
 * Busca matrículas com contratos prestes a expirar para alertas.
 */
export async function listarContratosProximosDeExpirar(
  contaId: string,
  diasAntecedencia = 30,
  options: AcademicJobOptions = {},
): Promise<
  Array<{
    id: string;
    alunoNome: string;
    dataFimContrato: Date;
    diasRestantes: number;
  }>
> {
  const now = options.now ?? new Date();
  const conta = options.timeZone
    ? null
    : await prisma.conta.findUnique({
        where: { id: contaId },
        select: { timezone: true },
      });
  const timeZone = options.timeZone ?? conta?.timezone;
  const academicDay = getAcademicDateBoundsForInstant(now, timeZone);
  const limitDate = getAcademicDateBoundsForStoredDate(
    addAcademicDays(academicDay.dateKey, diasAntecedencia),
  );

  const matriculas = await prisma.matricula.findMany({
    where: {
      aluno: { contaId },
      statusContrato: StatusContrato.ATIVO,
      status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
      dataFimContrato: {
        gte: academicDay.start,
        lte: limitDate.end,
      },
    },
    select: {
      id: true,
      dataFimContrato: true,
      aluno: { select: { nome: true } },
    },
    orderBy: { dataFimContrato: 'asc' },
  });

  return matriculas.map((m) => {
    const diasRestantes = getAcademicDateDifference(m.dataFimContrato, now, timeZone);
    return {
      id: m.id,
      alunoNome: m.aluno.nome ?? 'Sem nome',
      dataFimContrato: m.dataFimContrato,
      diasRestantes,
    };
  });
}
