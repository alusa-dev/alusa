import { StatusMatricula } from '@prisma/client';

/**
 * Status de matrícula que ocupam vaga na turma.
 *
 * Uma matrícula ocupa vaga quando está em processo de confirmação ou ativa.
 * Matrículas pausadas, recusadas ou canceladas liberam a vaga.
 *
 * - PENDENTE_TAXA: Aguardando pagamento da taxa de matrícula (reserva vaga)
 * - AGUARDANDO_CONFIRMACAO: Aguardando confirmação administrativa (reserva vaga)
 * - ATIVA: Matrícula confirmada e em andamento (ocupa vaga)
 */
export const SEAT_OCCUPYING_STATUSES: readonly StatusMatricula[] = [
  StatusMatricula.PENDENTE_TAXA,
  StatusMatricula.AGUARDANDO_CONFIRMACAO,
  StatusMatricula.ATIVA,
] as const;

/**
 * Status de matrícula que NÃO ocupam vaga na turma.
 *
 * - PAUSADA: Matrícula trancada temporariamente (libera vaga)
 * - RECUSADA: Matrícula rejeitada (nunca ocupou ou liberou vaga)
 * - CANCELADA: Matrícula encerrada definitivamente (liberou vaga)
 */
export const NON_SEAT_OCCUPYING_STATUSES: readonly StatusMatricula[] = [
  StatusMatricula.PAUSADA,
  StatusMatricula.RECUSADA,
  StatusMatricula.CANCELADA,
] as const;

/**
 * Verifica se uma matrícula com determinado status ocupa vaga na turma.
 *
 * Use esta função para:
 * - Calcular vagas disponíveis em uma turma
 * - Validar se há capacidade para nova matrícula
 * - Determinar se uma matrícula contribui para a contagem de alunos
 *
 * @param status - Status da matrícula a verificar
 * @returns true se a matrícula ocupa vaga, false caso contrário
 *
 * @example
 * doesMatriculaOccupySeat('ATIVA')       // true
 * doesMatriculaOccupySeat('PENDENTE_TAXA') // true
 * doesMatriculaOccupySeat('CANCELADA')   // false
 * doesMatriculaOccupySeat('PAUSADA')     // false
 */
export function doesMatriculaOccupySeat(status: StatusMatricula | string): boolean {
  return (SEAT_OCCUPYING_STATUSES as readonly string[]).includes(status);
}

/**
 * Retorna os status que devem ser usados em queries para contar vagas ocupadas.
 *
 * @example
 * // Em uma query Prisma:
 * const vagasOcupadas = await prisma.matricula.count({
 *   where: {
 *     turmaId,
 *     status: { in: getSeatOccupyingStatuses() }
 *   }
 * });
 */
export function getSeatOccupyingStatuses(): StatusMatricula[] {
  return [...SEAT_OCCUPYING_STATUSES];
}

/**
 * Cláusula canônica para queries Prisma que contam ocupação de vaga.
 *
 * Regra de domínio:
 * - PENDENTE_TAXA, AGUARDANDO_CONFIRMACAO e ATIVA sempre ocupam vaga.
 * - PAUSADA só ocupa vaga quando manterVaga=true.
 */
export function buildSeatOccupancyWhereClause() {
  return {
    OR: [
      { status: { in: getSeatOccupyingStatuses() } },
      { status: StatusMatricula.PAUSADA, manterVaga: true },
    ],
  };
}

/**
 * Calcula quantas vagas estão disponíveis em uma turma.
 *
 * @param capacidade - Capacidade máxima da turma
 * @param vagasOcupadas - Número de matrículas que ocupam vaga
 * @returns Objeto com informações de disponibilidade
 *
 * @example
 * const resultado = calcularVagasDisponiveis(30, 28);
 * // { disponiveis: 2, temVaga: true, alerta: true, mensagem: '⚠️ Apenas 2 vaga(s) restante(s)' }
 */
export function calcularVagasDisponiveis(
  capacidade: number,
  vagasOcupadas: number,
): {
  disponiveis: number;
  temVaga: boolean;
  alerta: boolean;
  mensagem?: string;
} {
  const disponiveis = Math.max(0, capacidade - vagasOcupadas);

  if (disponiveis === 0) {
    return {
      disponiveis: 0,
      temVaga: false,
      alerta: true,
      mensagem: 'Turma sem vagas disponíveis',
    };
  }

  if (disponiveis <= 2) {
    return {
      disponiveis,
      temVaga: true,
      alerta: true,
      mensagem: `⚠️ Apenas ${disponiveis} vaga(s) restante(s)`,
    };
  }

  return {
    disponiveis,
    temVaga: true,
    alerta: false,
  };
}
