import { prisma } from '../prisma';
import { createContractExpiredNotification } from '../notifications/domain-notifications';
import { StatusContrato, StatusMatricula } from '@prisma/client';

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
): Promise<EncerrarContratosResult> {
  if (!contaId) {
    throw new Error('contaId é obrigatório para garantir isolamento multi-tenant');
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const where = {
    contaId,
    status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
    dataFimContrato: { lt: hoje },
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
    dataExecucao: new Date(),
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
): Promise<
  Array<{
    id: string;
    alunoNome: string;
    dataFimContrato: Date;
    diasRestantes: number;
  }>
> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const dataLimite = new Date(hoje);
  dataLimite.setDate(dataLimite.getDate() + diasAntecedencia);

  const matriculas = await prisma.matricula.findMany({
    where: {
      aluno: { contaId },
      statusContrato: StatusContrato.ATIVO,
      status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
      dataFimContrato: {
        gte: hoje,
        lte: dataLimite,
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
    const diasRestantes = Math.ceil(
      (m.dataFimContrato.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000),
    );
    return {
      id: m.id,
      alunoNome: m.aluno.nome ?? 'Sem nome',
      dataFimContrato: m.dataFimContrato,
      diasRestantes,
    };
  });
}
