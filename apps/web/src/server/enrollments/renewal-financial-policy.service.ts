import { Prisma } from '@prisma/client';
import type {
  Cobranca,
  IntegrationSyncStatus,
  StatusCobranca,
  StatusFinanceiro,
} from '@prisma/client';

export type RematriculaDebtScope = 'QUALQUER_COBRANCA_EM_ABERTO' | 'APENAS_VENCIDAS';

export type RematriculaEligibilityStatus = 'ELEGIVEL' | 'NAO_ELEGIVEL';

export type RematriculaFinancialStatus =
  | 'REGULAR'
  | 'PENDENTE'
  | 'ATRASADO'
  | 'MULTIPLAS_COBRANCAS_EM_ABERTO'
  | 'DESCONHECIDO';

export type FinancialSnapshot = {
  financialStatus: RematriculaFinancialStatus;
  openChargesCount: number;
  overdueChargesCount: number;
  pendingChargesCount: number;
  futureChargesCount: number;
  uncertainChargesCount: number;
  relevantStatuses: StatusCobranca[];
  statusFinanceiro: StatusFinanceiro;
  integrationStatus: IntegrationSyncStatus;
};

export type RematriculaDecision = {
  eligibilityStatus: RematriculaEligibilityStatus;
  actionStatus: 'LIBERADA' | 'LIBERADA_COM_AVISO' | 'REQUER_OVERRIDE' | 'BLOQUEADA';
  blockReason:
    | 'SEM_BLOQUEIO'
    | 'COBRANCA_EM_ABERTO'
    | 'COBRANCA_ATRASADA'
    | 'MULTIPLAS_COBRANCAS'
    | 'AGUARDANDO_RECONCILIACAO'
    | 'OUTRO';
  message: string;
  canCurrentUserOverride: boolean;
  requiresOverrideReason: boolean;
  shouldBlockNewFinancialCycle: boolean;
};

const OPEN_CHARGE_STATUSES: StatusCobranca[] = ['A_VENCER', 'PENDENTE', 'ATRASADO'];
const UNCERTAIN_CHARGE_STATUSES: StatusCobranca[] = ['PROCESSANDO', 'CANCELAMENTO_PENDENTE'];

type ChargeSnapshot = Pick<Cobranca, 'status'>;

export function buildFinancialSnapshot(input: {
  cobrancas: ChargeSnapshot[];
  statusFinanceiro: StatusFinanceiro;
  integrationStatus: IntegrationSyncStatus;
  debtScope: RematriculaDebtScope;
}): FinancialSnapshot {
  const relevantStatuses = input.cobrancas.map((cobranca) => cobranca.status);
  const openCharges = input.cobrancas.filter((cobranca) => OPEN_CHARGE_STATUSES.includes(cobranca.status));
  const overdueCharges = input.cobrancas.filter((cobranca) => cobranca.status === 'ATRASADO');
  const pendingCharges = input.cobrancas.filter((cobranca) => cobranca.status === 'PENDENTE');
  const futureCharges = input.cobrancas.filter((cobranca) => cobranca.status === 'A_VENCER');
  const uncertainCharges = input.cobrancas.filter((cobranca) => UNCERTAIN_CHARGE_STATUSES.includes(cobranca.status));

  const isUnknown = input.integrationStatus !== 'SINCRONIZADO' || uncertainCharges.length > 0;

  let financialStatus: RematriculaFinancialStatus = 'REGULAR';
  if (isUnknown) {
    financialStatus = 'DESCONHECIDO';
  } else if (input.debtScope === 'APENAS_VENCIDAS') {
    financialStatus = overdueCharges.length > 0 ? 'ATRASADO' : 'REGULAR';
  } else if (openCharges.length > 1) {
    financialStatus = 'MULTIPLAS_COBRANCAS_EM_ABERTO';
  } else if (overdueCharges.length > 0) {
    financialStatus = 'ATRASADO';
  } else if (openCharges.length > 0) {
    financialStatus = 'PENDENTE';
  }

  return {
    financialStatus,
    openChargesCount: openCharges.length,
    overdueChargesCount: overdueCharges.length,
    pendingChargesCount: pendingCharges.length,
    futureChargesCount: futureCharges.length,
    uncertainChargesCount: uncertainCharges.length,
    relevantStatuses,
    statusFinanceiro: input.statusFinanceiro,
    integrationStatus: input.integrationStatus,
  };
}

function resolveDebtBlockReason(snapshot: FinancialSnapshot): RematriculaDecision['blockReason'] {
  switch (snapshot.financialStatus) {
    case 'DESCONHECIDO':
      return 'AGUARDANDO_RECONCILIACAO';
    case 'MULTIPLAS_COBRANCAS_EM_ABERTO':
      return 'MULTIPLAS_COBRANCAS';
    case 'ATRASADO':
      return 'COBRANCA_ATRASADA';
    case 'PENDENTE':
      return 'COBRANCA_EM_ABERTO';
    default:
      return 'SEM_BLOQUEIO';
  }
}

function resolveBaseDebtMessage(snapshot: FinancialSnapshot): string {
  switch (snapshot.financialStatus) {
    case 'DESCONHECIDO':
      return 'A situação financeira ainda está sendo reconciliada.';
    case 'MULTIPLAS_COBRANCAS_EM_ABERTO':
      return 'Existem múltiplas cobranças em aberto na matrícula anterior.';
    case 'ATRASADO':
      return 'Existe cobrança vencida vinculada à matrícula anterior.';
    case 'PENDENTE':
      return 'Existe cobrança em aberto vinculada à matrícula anterior.';
    default:
      return 'Rematrícula liberada pela regra canônica da Alusa.';
  }
}

export function evaluateCanonicalRematriculaDecision(input: {
  academicEligible: boolean;
  financialSnapshot: FinancialSnapshot;
}): RematriculaDecision {
  const baseMessage = resolveBaseDebtMessage(input.financialSnapshot);
  const isUnknown = input.financialSnapshot.financialStatus === 'DESCONHECIDO';
  const hasDebt = input.financialSnapshot.openChargesCount > 0;

  if (!input.academicEligible) {
    return {
      eligibilityStatus: 'NAO_ELEGIVEL',
      actionStatus: 'BLOQUEADA',
      blockReason: 'OUTRO',
      message: 'A matrícula não está elegível academicamente para rematrícula.',
      canCurrentUserOverride: false,
      requiresOverrideReason: false,
      shouldBlockNewFinancialCycle: true,
    };
  }

  if (!hasDebt && !isUnknown) {
    return {
      eligibilityStatus: 'ELEGIVEL',
      actionStatus: 'LIBERADA',
      blockReason: 'SEM_BLOQUEIO',
      message: 'Rematrícula liberada pela regra canônica da Alusa.',
      canCurrentUserOverride: false,
      requiresOverrideReason: false,
      shouldBlockNewFinancialCycle: false,
    };
  }

  return {
    eligibilityStatus: 'ELEGIVEL',
    actionStatus: 'LIBERADA_COM_AVISO',
    blockReason: isUnknown ? 'AGUARDANDO_RECONCILIACAO' : resolveDebtBlockReason(input.financialSnapshot),
    message: isUnknown
      ? `${baseMessage} A vaga futura pode ser reservada, mas o financeiro do próximo ciclo fica pendente de conferência.`
      : `${baseMessage} A vaga futura pode ser reservada, mas o financeiro do próximo ciclo fica pendente de regularização.`,
    canCurrentUserOverride: false,
    requiresOverrideReason: false,
    shouldBlockNewFinancialCycle: true,
  };
}

export type MatriculaFinancialDecisionRecord = {
  cobrancas: Array<Pick<Cobranca, 'status'>>;
  statusFinanceiro: StatusFinanceiro;
  integrationStatus: IntegrationSyncStatus;
};

export function serializeFinancialSnapshot(snapshot: FinancialSnapshot): Prisma.JsonObject {
  return {
    financialStatus: snapshot.financialStatus,
    openChargesCount: snapshot.openChargesCount,
    overdueChargesCount: snapshot.overdueChargesCount,
    pendingChargesCount: snapshot.pendingChargesCount,
    futureChargesCount: snapshot.futureChargesCount,
    uncertainChargesCount: snapshot.uncertainChargesCount,
    relevantStatuses: snapshot.relevantStatuses,
    statusFinanceiro: snapshot.statusFinanceiro,
    integrationStatus: snapshot.integrationStatus,
  } satisfies Prisma.JsonObject;
}
