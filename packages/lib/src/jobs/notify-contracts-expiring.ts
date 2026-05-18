import { listarContratosProximosDeExpirar } from './encerrar-contratos-expirados';
import { createContractExpiringNotification } from '../notifications/domain-notifications';

const EXPIRING_ALERT_DAYS = [7, 3, 1] as const;

/**
 * Notifica equipe sobre contratos que vencem em 7, 3 ou 1 dia(s).
 */
export async function notifyContractsExpiring(contaId: string): Promise<{
  evaluated: number;
  notified: number;
}> {
  const contracts = await listarContratosProximosDeExpirar(contaId, 30);
  let notified = 0;

  for (const item of contracts) {
    if (!EXPIRING_ALERT_DAYS.includes(item.diasRestantes as (typeof EXPIRING_ALERT_DAYS)[number])) {
      continue;
    }

    await createContractExpiringNotification({
      contaId,
      matriculaId: item.id,
      alunoNome: item.alunoNome,
      dataFimContrato: item.dataFimContrato,
      diasRestantes: item.diasRestantes,
    });
    notified += 1;
  }

  return { evaluated: contracts.length, notified };
}
