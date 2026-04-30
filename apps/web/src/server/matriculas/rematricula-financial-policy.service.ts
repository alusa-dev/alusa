import { Prisma } from '@prisma/client';
import type {
  Cobranca,
  IntegrationSyncStatus,
  RematriculaDebtPolicy as PrismaRematriculaDebtPolicy,
  RematriculaDebtScope as PrismaRematriculaDebtScope,
  Role,
  StatusCobranca,
  StatusFinanceiro,
} from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '@/src/prisma';

export type RematriculaFinancialPolicyPreset = 'FLEXIVEL' | 'CONTROLADA' | 'RESTRITIVA';
export type RematriculaDebtScope = 'QUALQUER_COBRANCA_EM_ABERTO' | 'APENAS_VENCIDAS';

export type FinancialPolicySnapshot = {
  preset: RematriculaFinancialPolicyPreset;
  debtScope: RematriculaDebtScope;
  overrideRoles: string[];
};

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
    | 'POLITICA_DA_ESCOLA'
    | 'OUTRO';
  message: string;
  canCurrentUserOverride: boolean;
  requiresOverrideReason: boolean;
  shouldBlockNewFinancialCycle: boolean;
};

const OPEN_CHARGE_STATUSES: StatusCobranca[] = ['A_VENCER', 'PENDENTE', 'ATRASADO'];
const UNCERTAIN_CHARGE_STATUSES: StatusCobranca[] = ['PROCESSANDO', 'CANCELAMENTO_PENDENTE'];
const DEFAULT_OVERRIDE_ROLES: Array<Role> = ['ADMIN', 'FINANCEIRO'];

export const DEFAULT_FINANCIAL_POLICY: FinancialPolicySnapshot = {
  preset: 'FLEXIVEL',
  debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
  overrideRoles: [],
};

export type FinancialPolicyRecord = FinancialPolicySnapshot & {
  updatedAt: Date;
};

type FinancialPolicyPersistenceInput = FinancialPolicySnapshot;

type FinancialPolicyRow = {
  rematriculaDebtPolicy: string;
  allowNewFinancialCycleWithOpenDebt: boolean;
  debtScope: string;
  overrideRoles: string[];
  requireOverrideReason: boolean;
  requireFullAudit: boolean;
  blockOnUnknownFinancialStatus: boolean;
  updatedAt: Date;
};

function normalizeOverrideRoles(roles: string[], preset: RematriculaFinancialPolicyPreset): string[] {
  const unique = Array.from(new Set(roles.filter((role) => FINANCIAL_POLICY_ALLOWED_OVERRIDE_ROLES.includes(role as Role))));
  if (preset !== 'CONTROLADA') return [];
  return unique.length > 0 ? unique : [...DEFAULT_OVERRIDE_ROLES];
}

function normalizePreset(value: string): RematriculaFinancialPolicyPreset {
  switch (value) {
    case 'PERMITIR_COM_OVERRIDE':
    case 'PERMITIR_COM_AUTORIZACAO_ADMINISTRATIVA':
      return 'CONTROLADA';
    case 'BLOQUEAR':
    case 'BLOQUEAR_REMATRICULA':
      return 'RESTRITIVA';
    case 'PERMITIR_COM_AVISO':
    case 'PERMITIR_NORMALMENTE':
    default:
      return 'FLEXIVEL';
  }
}

function normalizeDebtScope(value: string): RematriculaDebtScope {
  switch (value) {
    case 'APENAS_VENCIDAS':
    case 'SOMENTE_ATRASADAS':
      return 'APENAS_VENCIDAS';
    case 'MULTIPLAS_EM_ABERTO':
    case 'QUALQUER_COBRANCA_EM_ABERTO':
    default:
      return 'QUALQUER_COBRANCA_EM_ABERTO';
  }
}

function mapPresetToPersistenceValue(preset: RematriculaFinancialPolicyPreset): PrismaRematriculaDebtPolicy {
  switch (preset) {
    case 'CONTROLADA':
      return 'PERMITIR_COM_AUTORIZACAO_ADMINISTRATIVA';
    case 'RESTRITIVA':
      return 'BLOQUEAR_REMATRICULA';
    case 'FLEXIVEL':
    default:
      return 'PERMITIR_COM_AVISO';
  }
}

function mapDebtScopeToPersistenceValue(scope: RematriculaDebtScope): PrismaRematriculaDebtScope {
  switch (scope) {
    case 'APENAS_VENCIDAS':
      return 'SOMENTE_ATRASADAS';
    case 'QUALQUER_COBRANCA_EM_ABERTO':
    default:
      return 'QUALQUER_COBRANCA_EM_ABERTO';
  }
}

function getFinancialPolicyDelegate() {
  return (prisma as typeof prisma & {
    contaFinancialPolicy?: {
      findUnique: (_args: unknown) => Promise<FinancialPolicyRow | null>;
      upsert: (_args: unknown) => Promise<FinancialPolicyRow>;
    };
  }).contaFinancialPolicy;
}

function normalizeFinancialPolicyRow(policy: FinancialPolicyRow | null): FinancialPolicyRecord | null {
  if (!policy) return null;

  const preset = normalizePreset(policy.rematriculaDebtPolicy);

  return {
    preset,
    debtScope: normalizeDebtScope(policy.debtScope),
    overrideRoles: normalizeOverrideRoles(policy.overrideRoles, preset),
    updatedAt: policy.updatedAt,
  };
}

async function getFinancialPolicyByRawQuery(contaId: string): Promise<FinancialPolicyRecord | null> {
  const rows = await prisma.$queryRaw<FinancialPolicyRow[]>(Prisma.sql`
    SELECT
      "rematriculaDebtPolicy",
      "allowNewFinancialCycleWithOpenDebt",
      "debtScope",
      "overrideRoles",
      "requireOverrideReason",
      "requireFullAudit",
      "blockOnUnknownFinancialStatus",
      "updatedAt"
    FROM "ContaFinancialPolicy"
    WHERE "contaId" = ${contaId}
    LIMIT 1
  `);

  return normalizeFinancialPolicyRow(rows[0] ?? null);
}

async function upsertFinancialPolicyByRawQuery(
  contaId: string,
  input: FinancialPolicyPersistenceInput,
): Promise<FinancialPolicyRecord> {
  const id = crypto.randomUUID();
  const roles = normalizeOverrideRoles(input.overrideRoles, input.preset);
  const rematriculaDebtPolicy = mapPresetToPersistenceValue(input.preset);
  const debtScope = mapDebtScopeToPersistenceValue(input.debtScope);
  const blockOnUnknownFinancialStatus = input.preset === 'RESTRITIVA';
  const requireOverrideReason = input.preset === 'CONTROLADA';
  const allowNewFinancialCycleWithOpenDebt = input.preset !== 'RESTRITIVA';

  const rows = await prisma.$queryRaw<FinancialPolicyRow[]>(Prisma.sql`
    INSERT INTO "ContaFinancialPolicy" (
      "id",
      "contaId",
      "rematriculaDebtPolicy",
      "allowNewFinancialCycleWithOpenDebt",
      "debtScope",
      "overrideRoles",
      "requireOverrideReason",
      "requireFullAudit",
      "blockOnUnknownFinancialStatus",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${contaId},
      ${rematriculaDebtPolicy}::"RematriculaDebtPolicy",
      ${allowNewFinancialCycleWithOpenDebt},
      ${debtScope}::"RematriculaDebtScope",
      ARRAY[${Prisma.join(roles)}]::text[],
      ${requireOverrideReason},
      true,
      ${blockOnUnknownFinancialStatus},
      NOW(),
      NOW()
    )
    ON CONFLICT ("contaId") DO UPDATE SET
      "rematriculaDebtPolicy" = EXCLUDED."rematriculaDebtPolicy",
      "allowNewFinancialCycleWithOpenDebt" = EXCLUDED."allowNewFinancialCycleWithOpenDebt",
      "debtScope" = EXCLUDED."debtScope",
      "overrideRoles" = EXCLUDED."overrideRoles",
      "requireOverrideReason" = EXCLUDED."requireOverrideReason",
      "requireFullAudit" = EXCLUDED."requireFullAudit",
      "blockOnUnknownFinancialStatus" = EXCLUDED."blockOnUnknownFinancialStatus",
      "updatedAt" = NOW()
    RETURNING
      "rematriculaDebtPolicy",
      "allowNewFinancialCycleWithOpenDebt",
      "debtScope",
      "overrideRoles",
      "requireOverrideReason",
      "requireFullAudit",
      "blockOnUnknownFinancialStatus",
      "updatedAt"
  `);

  const policy = normalizeFinancialPolicyRow(rows[0] ?? null);
  if (!policy) {
    throw new Error('Não foi possível salvar a regra financeira da rematrícula.');
  }

  return policy;
}

export async function getContaFinancialPolicyRecord(contaId: string): Promise<FinancialPolicyRecord | null> {
  const delegate = getFinancialPolicyDelegate();
  if (delegate?.findUnique) {
    const policy = await delegate.findUnique({
      where: { contaId },
      select: {
        rematriculaDebtPolicy: true,
        allowNewFinancialCycleWithOpenDebt: true,
        debtScope: true,
        overrideRoles: true,
        requireOverrideReason: true,
        requireFullAudit: true,
        blockOnUnknownFinancialStatus: true,
        updatedAt: true,
      },
    });
    return normalizeFinancialPolicyRow(policy);
  }

  return getFinancialPolicyByRawQuery(contaId);
}

export async function upsertContaFinancialPolicy(
  contaId: string,
  input: FinancialPolicyPersistenceInput,
): Promise<FinancialPolicyRecord> {
  const delegate = getFinancialPolicyDelegate();
  const normalizedInput: FinancialPolicyPersistenceInput = {
    preset: input.preset,
    debtScope: input.debtScope,
    overrideRoles: normalizeOverrideRoles(input.overrideRoles, input.preset),
  };

  if (delegate?.upsert) {
    const rematriculaDebtPolicy = mapPresetToPersistenceValue(normalizedInput.preset);
    const debtScope = mapDebtScopeToPersistenceValue(normalizedInput.debtScope);
    const policy = await delegate.upsert({
      where: { contaId },
      update: {
        rematriculaDebtPolicy,
        allowNewFinancialCycleWithOpenDebt: normalizedInput.preset !== 'RESTRITIVA',
        debtScope,
        overrideRoles: normalizedInput.overrideRoles,
        requireOverrideReason: normalizedInput.preset === 'CONTROLADA',
        requireFullAudit: true,
        blockOnUnknownFinancialStatus: normalizedInput.preset === 'RESTRITIVA',
      },
      create: {
        contaId,
        rematriculaDebtPolicy,
        allowNewFinancialCycleWithOpenDebt: normalizedInput.preset !== 'RESTRITIVA',
        debtScope,
        overrideRoles: normalizedInput.overrideRoles,
        requireOverrideReason: normalizedInput.preset === 'CONTROLADA',
        requireFullAudit: true,
        blockOnUnknownFinancialStatus: normalizedInput.preset === 'RESTRITIVA',
      },
      select: {
        rematriculaDebtPolicy: true,
        allowNewFinancialCycleWithOpenDebt: true,
        debtScope: true,
        overrideRoles: true,
        requireOverrideReason: true,
        requireFullAudit: true,
        blockOnUnknownFinancialStatus: true,
        updatedAt: true,
      },
    });
    return normalizeFinancialPolicyRow(policy) as FinancialPolicyRecord;
  }

  return upsertFinancialPolicyByRawQuery(contaId, normalizedInput);
}

export async function getContaFinancialPolicy(contaId: string): Promise<FinancialPolicySnapshot> {
  const policy = await getContaFinancialPolicyRecord(contaId);
  if (!policy) return DEFAULT_FINANCIAL_POLICY;

  return {
    preset: policy.preset,
    debtScope: policy.debtScope,
    overrideRoles: policy.overrideRoles,
  };
}

type ChargeSnapshot = Pick<Cobranca, 'status'>;

export function buildFinancialSnapshot(input: {
  cobrancas: ChargeSnapshot[];
  statusFinanceiro: StatusFinanceiro;
  integrationStatus: IntegrationSyncStatus;
  debtScope: FinancialPolicySnapshot['debtScope'];
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
      return 'Rematrícula liberada conforme a regra da escola.';
  }
}

function hasRelevantDebt(snapshot: FinancialSnapshot, debtScope: RematriculaDebtScope) {
  return debtScope === 'APENAS_VENCIDAS' ? snapshot.overdueChargesCount > 0 : snapshot.openChargesCount > 0;
}

export function evaluateRematriculaDecision(input: {
  academicEligible: boolean;
  financialSnapshot: FinancialSnapshot;
  policy: FinancialPolicySnapshot;
  currentUserRole?: string | null;
}): RematriculaDecision {
  const normalizedRole = input.currentUserRole?.toUpperCase() ?? null;
  const baseMessage = resolveBaseDebtMessage(input.financialSnapshot);
  const isUnknown = input.financialSnapshot.financialStatus === 'DESCONHECIDO';
  const relevantDebt = hasRelevantDebt(input.financialSnapshot, input.policy.debtScope);
  const canCurrentUserOverride =
    normalizedRole != null &&
    input.policy.preset === 'CONTROLADA' &&
    input.policy.overrideRoles.map((role) => role.toUpperCase()).includes(normalizedRole);

  if (!input.academicEligible) {
    return {
      eligibilityStatus: 'NAO_ELEGIVEL',
      actionStatus: 'BLOQUEADA',
      blockReason: 'OUTRO',
      message: 'A matrícula não está elegível academicamente para rematrícula.',
      canCurrentUserOverride,
      requiresOverrideReason: false,
      shouldBlockNewFinancialCycle: true,
    };
  }

  if (!relevantDebt && !isUnknown) {
    return {
      eligibilityStatus: 'ELEGIVEL',
      actionStatus: 'LIBERADA',
      blockReason: 'SEM_BLOQUEIO',
      message: 'Rematrícula liberada conforme a regra da escola.',
      canCurrentUserOverride,
      requiresOverrideReason: false,
      shouldBlockNewFinancialCycle: false,
    };
  }

  if (input.policy.preset === 'FLEXIVEL') {
    return {
      eligibilityStatus: 'ELEGIVEL',
      actionStatus: relevantDebt || isUnknown ? 'LIBERADA_COM_AVISO' : 'LIBERADA',
      blockReason: isUnknown ? 'AGUARDANDO_RECONCILIACAO' : relevantDebt ? resolveDebtBlockReason(input.financialSnapshot) : 'SEM_BLOQUEIO',
      message: isUnknown
        ? `${baseMessage} A rematrícula pode seguir com alerta para conferência da equipe.`
        : `${baseMessage} A rematrícula seguirá com alerta para a equipe.`,
      canCurrentUserOverride: false,
      requiresOverrideReason: false,
      shouldBlockNewFinancialCycle: false,
    };
  }

  if (input.policy.preset === 'CONTROLADA') {
    if (relevantDebt || isUnknown) {
      return {
        eligibilityStatus: 'ELEGIVEL',
        actionStatus: 'REQUER_OVERRIDE',
        blockReason: isUnknown ? 'AGUARDANDO_RECONCILIACAO' : resolveDebtBlockReason(input.financialSnapshot),
        message: isUnknown
          ? `${baseMessage} A rematrícula exige autorização da gestão antes de prosseguir.`
          : `${baseMessage} A rematrícula exige autorização da gestão para prosseguir.`,
        canCurrentUserOverride,
        requiresOverrideReason: true,
        shouldBlockNewFinancialCycle: false,
      };
    }
  }

  return {
    eligibilityStatus: 'ELEGIVEL',
    actionStatus: 'BLOQUEADA',
    blockReason: isUnknown ? 'AGUARDANDO_RECONCILIACAO' : resolveDebtBlockReason(input.financialSnapshot),
    message: isUnknown
      ? `${baseMessage} A rematrícula permanece bloqueada até a reconciliação financeira.`
      : `${baseMessage} A rematrícula permanece bloqueada até a regularização.`,
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

export function serializePolicySnapshot(policy: FinancialPolicySnapshot): Prisma.JsonObject {
  return {
    preset: policy.preset,
    debtScope: policy.debtScope,
    overrideRoles: policy.overrideRoles,
  } satisfies Prisma.JsonObject;
}

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

export const FINANCIAL_POLICY_ALLOWED_OVERRIDE_ROLES: Array<Role> = ['ADMIN', 'FINANCEIRO', 'RECEPCAO'];
