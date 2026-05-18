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
 * Job que encerra automaticamente contratos expirados.
 * Atualiza matrículas com statusContrato = ATIVO e dataFimContrato < hoje.
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
    statusContrato: StatusContrato.ATIVO,
    status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
    dataFimContrato: { lt: hoje },
    aluno: { contaId },
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
        await tx.matricula.update({
          where: { id: matricula.id },
          data: {
            statusContrato: StatusContrato.EXPIRADO,
            dataFim: matricula.dataFim ?? matricula.dataFimContrato,
          },
        });

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
