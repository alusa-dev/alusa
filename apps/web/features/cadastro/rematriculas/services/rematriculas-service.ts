import type { MatriculaStatus } from '@/features/cadastro/matriculas/services/matriculas-service';
import { formatRematriculaFamiliarValidationMessage } from '@/lib/api/rematricula-familiar-input';
import type { ZodIssue } from 'zod';
import {
  createRematriculaResultDTOSchema,
  listRematriculasResultDTOSchema,
  rematriculaItemDTOSchema,
  type RematriculaAlunoDTO as RematriculaAluno,
  type RematriculaComboDTO as RematriculaCombo,
  type RematriculaDescontoResumoDTO,
  type RematriculaFinanceiroDTO as RematriculaFinanceiro,
  type RematriculaFormaPagamentoDTO as FormaPagamentoValue,
  type RematriculaItemDTO as RematriculaElegivelItem,
  type RematriculaPlanoDTO as RematriculaPlano,
  type RematriculaResponsavelDTO as RematriculaResponsavel,
  type RematriculaStatusContratoDTO as StatusContrato,
  type RematriculaTurmaDTO as RematriculaTurma,
} from '../dtos';

export type { FormaPagamentoValue, RematriculaElegivelItem, StatusContrato };

export interface ListRematriculasParams {
  contaId: string;
  diasAntecedencia?: number;
  statusContrato?: StatusContrato;
  referencia?: string;
  targetPeriodId?: string;
  search?: string;
  signal?: AbortSignal;
}

export interface ListRematriculasResponse {
  referencia: string;
  ate: string;
  total: number;
  itens: RematriculaElegivelItem[];
  campaigns: RematriculaCampaignSummary[];
  participants: RematriculaParticipantSummary[];
  processes: RematriculaProcessSummary[];
  history: RematriculaProcessSummary[];
}

export interface RematriculaCampaignSummary {
  id: string;
  targetPeriodId: string;
  nome: string;
  descricao: string | null;
  campaignStartsAt: string;
  campaignEndsAt: string | null;
  rules: Record<string, unknown> | null;
  audienceDefinition: Record<string, unknown> | null;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'DELETED' | 'ARCHIVED';
  version: number;
  metrics: { participantes: number; processos: number };
}

export interface RematriculaParticipantSummary {
  id: string;
  campanhaId: string;
  matriculaOrigemId: string;
  alunoId: string;
  responsavelId: string | null;
  status: string;
  eligibilityReason: string | null;
  currentContractEndsAt: string | null;
  includedAt: string;
  snapshot: unknown;
}

export interface RematriculaPendingSummary {
  id: string;
  type: string;
  severity: string;
  status: string;
  code: string;
  title: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RematriculaExceptionSummary {
  id: string;
  permission: string;
  rule: string;
  impact: string;
  justification: string;
  status: string;
  createdAt: string;
}

export interface RematriculaCommunicationSummary {
  id: string;
  channel: string;
  audience: string;
  status: string;
  subject: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface RematriculaProcessSummary {
  id: string;
  campanhaId: string | null;
  campanha: { id: string; nome: string; status: string } | null;
  origin: 'CAMPAIGN' | 'STANDALONE';
  targetPeriodId: string;
  holderType: 'STUDENT' | 'RESPONSIBLE';
  holderId: string;
  status:
    | 'DRAFT'
    | 'PREVIEWED'
    | 'PARTIALLY_CONFIRMED'
    | 'CONFIRMED'
    | 'WAITING_FOR_START'
    | 'REQUIRES_ATTENTION'
    | 'EFFECTIVE'
    | 'CANCELLED'
    | 'COMPLETED';
  effectiveAt: string;
  firstDueDate: string | null;
  confirmedAt: string | null;
  renewCount: number;
  pendingCount: number;
  nonRenewalCount: number;
  monthlyTotal: number;
  enrollmentFeeTotal: number;
  version: number;
  itens: Array<{
    id: string;
    decision: string;
    status: string;
    matriculaOrigemId: string;
    matriculaFuturaId: string | null;
    targetType: string | null;
    targetClassId: string | null;
    targetComboId: string | null;
    targetPlanId: string | null;
    effectiveAt: string | null;
    targetSnapshot: Record<string, unknown> | null;
    aluno: { id: string; nome: string; cpf?: string | null; foto?: string | null } | null;
    matriculaAtual?: {
      id: string;
      dataInicio: string;
      dataFimContrato: string;
      status: string;
      statusContrato: string;
      taxaMatricula: number;
      taxaIsenta: boolean;
      taxaJustificativa: string | null;
      formaPagamento: string | null;
      formaPagamentoTaxa: string | null;
      vencimentoDia: number | null;
      jurosMensal: number;
      multaPercentual: number;
      descontoAntecipado: number;
      prazoDesconto: number | null;
    } | null;
    matriculaFutura?: {
      id: string;
      dataInicio: string;
      dataFimContrato: string;
      turmaId: string | null;
      comboId: string | null;
      planoId: string | null;
      taxaMatricula: number;
      taxaIsenta: boolean;
      taxaJustificativa: string | null;
      formaPagamento: string | null;
      formaPagamentoTaxa: string | null;
      vencimentoDia: number | null;
      jurosMensal: number;
      multaPercentual: number;
      descontoAntecipado: number;
      prazoDesconto: number | null;
    } | null;
    turmaAtual?: { id: string; nome: string } | null;
    planoAtual?: { id: string; nome: string } | null;
    comboAtual?: { id: string; nome: string } | null;
  }>;
  reservas: Array<{ id: string; status: string; targetClassId: string | null; effectiveAt: string }>;
  contratos: Array<{ id: string; status: string; contractModelId: string | null; validFrom: string | null; validUntil: string | null }>;
  financeiros: Array<{
    id: string;
    status: string;
    monthlyTotal: number;
    enrollmentFeeTotal: number;
    firstDueDate: string | null;
    effectiveAt: string;
    provisionAt: string | null;
    feeChargeMoment: string | null;
    feeUnit: string | null;
    feePurpose: string | null;
    asaasSubscriptionId: string | null;
    asaasPaymentId: string | null;
    snapshot?: Record<string, unknown> | null;
  }>;
  pendencias: RematriculaPendingSummary[];
  excecoes: RematriculaExceptionSummary[];
  comunicacoes: RematriculaCommunicationSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface RematriculaCancelResult {
  processId: string;
  status: 'CANCELLED';
  remoteCancellation?: {
    status: 'NOT_NEEDED' | 'CANCELLED' | 'REQUIRES_RECONCILIATION' | 'FAILED';
    cancelledPaymentIds?: string[];
    cancelledSubscriptionIds?: string[];
    alreadyAbsentPaymentIds?: string[];
    alreadyAbsentSubscriptionIds?: string[];
    issues?: Array<{
      targetType: 'PAYMENT' | 'SUBSCRIPTION';
      externalId: string;
      code: string;
      message: string;
      uncertain: boolean;
    }>;
  };
}

function normalizeCampaign(raw: unknown): RematriculaCampaignSummary {
  const record = (raw as Record<string, unknown>) || {};
  const metrics = (record.metrics as Record<string, unknown>) || {};
  return {
    id: String(record.id ?? ''),
    targetPeriodId: String(record.targetPeriodId ?? ''),
    nome: String(record.nome ?? ''),
    descricao: record.descricao == null ? null : String(record.descricao),
    campaignStartsAt: parseDate(record.campaignStartsAt) ?? new Date().toISOString(),
    campaignEndsAt: parseDate(record.campaignEndsAt),
    rules:
      record.rules && typeof record.rules === 'object'
        ? (record.rules as Record<string, unknown>)
        : null,
    audienceDefinition:
      record.audienceDefinition && typeof record.audienceDefinition === 'object'
        ? (record.audienceDefinition as Record<string, unknown>)
        : null,
    status: String(record.status ?? 'DRAFT') as RematriculaCampaignSummary['status'],
    version: parseNumber(record.version, 1),
    metrics: {
      participantes: parseNumber(metrics.participantes, 0),
      processos: parseNumber(metrics.processos, 0),
    },
  };
}

function normalizeParticipant(raw: unknown): RematriculaParticipantSummary {
  const record = (raw as Record<string, unknown>) || {};
  return {
    id: String(record.id ?? ''),
    campanhaId: String(record.campanhaId ?? ''),
    matriculaOrigemId: String(record.matriculaOrigemId ?? ''),
    alunoId: String(record.alunoId ?? ''),
    responsavelId: record.responsavelId == null ? null : String(record.responsavelId),
    status: String(record.status ?? ''),
    eligibilityReason: record.eligibilityReason == null ? null : String(record.eligibilityReason),
    currentContractEndsAt: parseDate(record.currentContractEndsAt),
    includedAt: parseDate(record.includedAt) ?? new Date().toISOString(),
    snapshot: record.snapshot ?? null,
  };
}

function normalizeProcess(raw: unknown): RematriculaProcessSummary {
  const record = (raw as Record<string, unknown>) || {};
  const campanha = (record.campanha as Record<string, unknown> | null) ?? null;
  return {
    id: String(record.id ?? ''),
    campanhaId: record.campanhaId == null ? null : String(record.campanhaId),
    campanha: campanha
      ? {
          id: String(campanha.id ?? ''),
          nome: String(campanha.nome ?? ''),
          status: String(campanha.status ?? ''),
        }
      : null,
    origin: String(record.origin ?? 'STANDALONE') as RematriculaProcessSummary['origin'],
    targetPeriodId: String(record.targetPeriodId ?? ''),
    holderType: String(record.holderType ?? 'STUDENT') as RematriculaProcessSummary['holderType'],
    holderId: String(record.holderId ?? ''),
    status: String(record.status ?? 'DRAFT') as RematriculaProcessSummary['status'],
    effectiveAt: parseDate(record.effectiveAt) ?? new Date().toISOString(),
    firstDueDate: parseDate(record.firstDueDate),
    confirmedAt: parseDate(record.confirmedAt),
    renewCount: parseNumber(record.renewCount, 0),
    pendingCount: parseNumber(record.pendingCount, 0),
    nonRenewalCount: parseNumber(record.nonRenewalCount, 0),
    monthlyTotal: parseNumber(record.monthlyTotal, 0),
    enrollmentFeeTotal: parseNumber(record.enrollmentFeeTotal, 0),
    version: parseNumber(record.version, 1),
    itens: Array.isArray(record.itens)
      ? record.itens.map((item) => {
          const itemRecord = (item as Record<string, unknown>) || {};
          return {
            id: String(itemRecord.id ?? ''),
            decision: String(itemRecord.decision ?? ''),
            status: String(itemRecord.status ?? ''),
            matriculaOrigemId: String(itemRecord.matriculaOrigemId ?? ''),
            matriculaFuturaId: itemRecord.matriculaFuturaId == null ? null : String(itemRecord.matriculaFuturaId),
            targetType: itemRecord.targetType == null ? null : String(itemRecord.targetType),
            targetClassId: itemRecord.targetClassId == null ? null : String(itemRecord.targetClassId),
            targetComboId: itemRecord.targetComboId == null ? null : String(itemRecord.targetComboId),
            targetPlanId: itemRecord.targetPlanId == null ? null : String(itemRecord.targetPlanId),
            effectiveAt: parseDate(itemRecord.effectiveAt),
            targetSnapshot:
              itemRecord.targetSnapshot && typeof itemRecord.targetSnapshot === 'object'
                ? (itemRecord.targetSnapshot as Record<string, unknown>)
                : null,
            aluno: itemRecord.aluno && typeof itemRecord.aluno === 'object'
              ? {
                  id: String((itemRecord.aluno as Record<string, unknown>).id ?? ''),
                  nome: String((itemRecord.aluno as Record<string, unknown>).nome ?? ''),
                  cpf: ((itemRecord.aluno as Record<string, unknown>).cpf as string | null) ?? null,
                  foto: ((itemRecord.aluno as Record<string, unknown>).foto as string | null) ?? null,
                }
              : null,
            matriculaAtual:
              itemRecord.matriculaAtual && typeof itemRecord.matriculaAtual === 'object'
                ? {
                    id: String((itemRecord.matriculaAtual as Record<string, unknown>).id ?? ''),
                    dataInicio:
                      parseDate((itemRecord.matriculaAtual as Record<string, unknown>).dataInicio) ??
                      new Date().toISOString(),
                    dataFimContrato:
                      parseDate((itemRecord.matriculaAtual as Record<string, unknown>).dataFimContrato) ??
                      new Date().toISOString(),
                    status: String((itemRecord.matriculaAtual as Record<string, unknown>).status ?? ''),
                    statusContrato: String(
                      (itemRecord.matriculaAtual as Record<string, unknown>).statusContrato ?? '',
                    ),
                    taxaMatricula: parseNumber(
                      (itemRecord.matriculaAtual as Record<string, unknown>).taxaMatricula,
                      0,
                    ),
                    taxaIsenta: Boolean((itemRecord.matriculaAtual as Record<string, unknown>).taxaIsenta),
                    taxaJustificativa:
                      (itemRecord.matriculaAtual as Record<string, unknown>).taxaJustificativa == null
                        ? null
                        : String((itemRecord.matriculaAtual as Record<string, unknown>).taxaJustificativa),
                    formaPagamento:
                      (itemRecord.matriculaAtual as Record<string, unknown>).formaPagamento == null
                        ? null
                        : String((itemRecord.matriculaAtual as Record<string, unknown>).formaPagamento),
                    formaPagamentoTaxa:
                      (itemRecord.matriculaAtual as Record<string, unknown>).formaPagamentoTaxa == null
                        ? null
                        : String((itemRecord.matriculaAtual as Record<string, unknown>).formaPagamentoTaxa),
                    vencimentoDia:
                      (itemRecord.matriculaAtual as Record<string, unknown>).vencimentoDia == null
                        ? null
                        : parseNumber((itemRecord.matriculaAtual as Record<string, unknown>).vencimentoDia, 0),
                    jurosMensal: parseNumber(
                      (itemRecord.matriculaAtual as Record<string, unknown>).jurosMensal,
                      0,
                    ),
                    multaPercentual: parseNumber(
                      (itemRecord.matriculaAtual as Record<string, unknown>).multaPercentual,
                      0,
                    ),
                    descontoAntecipado: parseNumber(
                      (itemRecord.matriculaAtual as Record<string, unknown>).descontoAntecipado,
                      0,
                    ),
                    prazoDesconto:
                      (itemRecord.matriculaAtual as Record<string, unknown>).prazoDesconto == null
                        ? null
                        : parseNumber((itemRecord.matriculaAtual as Record<string, unknown>).prazoDesconto, 0),
                  }
                : null,
            matriculaFutura:
              itemRecord.matriculaFutura && typeof itemRecord.matriculaFutura === 'object'
                ? {
                    id: String((itemRecord.matriculaFutura as Record<string, unknown>).id ?? ''),
                    dataInicio:
                      parseDate((itemRecord.matriculaFutura as Record<string, unknown>).dataInicio) ??
                      new Date().toISOString(),
                    dataFimContrato:
                      parseDate((itemRecord.matriculaFutura as Record<string, unknown>).dataFimContrato) ??
                      new Date().toISOString(),
                    turmaId:
                      (itemRecord.matriculaFutura as Record<string, unknown>).turmaId == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).turmaId),
                    comboId:
                      (itemRecord.matriculaFutura as Record<string, unknown>).comboId == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).comboId),
                    planoId:
                      (itemRecord.matriculaFutura as Record<string, unknown>).planoId == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).planoId),
                    taxaMatricula: parseNumber(
                      (itemRecord.matriculaFutura as Record<string, unknown>).taxaMatricula,
                      0,
                    ),
                    taxaIsenta: Boolean((itemRecord.matriculaFutura as Record<string, unknown>).taxaIsenta),
                    taxaJustificativa:
                      (itemRecord.matriculaFutura as Record<string, unknown>).taxaJustificativa == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).taxaJustificativa),
                    formaPagamento:
                      (itemRecord.matriculaFutura as Record<string, unknown>).formaPagamento == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).formaPagamento),
                    formaPagamentoTaxa:
                      (itemRecord.matriculaFutura as Record<string, unknown>).formaPagamentoTaxa == null
                        ? null
                        : String((itemRecord.matriculaFutura as Record<string, unknown>).formaPagamentoTaxa),
                    vencimentoDia:
                      (itemRecord.matriculaFutura as Record<string, unknown>).vencimentoDia == null
                        ? null
                        : parseNumber((itemRecord.matriculaFutura as Record<string, unknown>).vencimentoDia, 0),
                    jurosMensal: parseNumber(
                      (itemRecord.matriculaFutura as Record<string, unknown>).jurosMensal,
                      0,
                    ),
                    multaPercentual: parseNumber(
                      (itemRecord.matriculaFutura as Record<string, unknown>).multaPercentual,
                      0,
                    ),
                    descontoAntecipado: parseNumber(
                      (itemRecord.matriculaFutura as Record<string, unknown>).descontoAntecipado,
                      0,
                    ),
                    prazoDesconto:
                      (itemRecord.matriculaFutura as Record<string, unknown>).prazoDesconto == null
                        ? null
                        : parseNumber((itemRecord.matriculaFutura as Record<string, unknown>).prazoDesconto, 0),
                  }
                : null,
            turmaAtual:
              itemRecord.turmaAtual && typeof itemRecord.turmaAtual === 'object'
                ? {
                    id: String((itemRecord.turmaAtual as Record<string, unknown>).id ?? ''),
                    nome: String((itemRecord.turmaAtual as Record<string, unknown>).nome ?? ''),
                  }
                : null,
            planoAtual:
              itemRecord.planoAtual && typeof itemRecord.planoAtual === 'object'
                ? {
                    id: String((itemRecord.planoAtual as Record<string, unknown>).id ?? ''),
                    nome: String((itemRecord.planoAtual as Record<string, unknown>).nome ?? ''),
                  }
                : null,
            comboAtual:
              itemRecord.comboAtual && typeof itemRecord.comboAtual === 'object'
                ? {
                    id: String((itemRecord.comboAtual as Record<string, unknown>).id ?? ''),
                    nome: String((itemRecord.comboAtual as Record<string, unknown>).nome ?? ''),
                  }
                : null,
          };
        })
      : [],
    reservas: Array.isArray(record.reservas) ? (record.reservas as RematriculaProcessSummary['reservas']) : [],
    contratos: Array.isArray(record.contratos) ? (record.contratos as RematriculaProcessSummary['contratos']) : [],
    financeiros: Array.isArray(record.financeiros)
      ? record.financeiros.map((financeiro) => {
          const financeiroRecord = (financeiro as Record<string, unknown>) || {};
          return {
            id: String(financeiroRecord.id ?? ''),
            status: String(financeiroRecord.status ?? ''),
            monthlyTotal: parseNumber(financeiroRecord.monthlyTotal, 0),
            enrollmentFeeTotal: parseNumber(financeiroRecord.enrollmentFeeTotal, 0),
            firstDueDate: parseDate(financeiroRecord.firstDueDate),
            effectiveAt: parseDate(financeiroRecord.effectiveAt) ?? new Date().toISOString(),
            provisionAt: parseDate(financeiroRecord.provisionAt),
            feeChargeMoment:
              financeiroRecord.feeChargeMoment == null ? null : String(financeiroRecord.feeChargeMoment),
            feeUnit: financeiroRecord.feeUnit == null ? null : String(financeiroRecord.feeUnit),
            feePurpose: financeiroRecord.feePurpose == null ? null : String(financeiroRecord.feePurpose),
            asaasSubscriptionId:
              financeiroRecord.asaasSubscriptionId == null ? null : String(financeiroRecord.asaasSubscriptionId),
            asaasPaymentId:
              financeiroRecord.asaasPaymentId == null ? null : String(financeiroRecord.asaasPaymentId),
            snapshot:
              financeiroRecord.snapshot && typeof financeiroRecord.snapshot === 'object'
                ? (financeiroRecord.snapshot as Record<string, unknown>)
                : null,
          };
        })
      : [],
    pendencias: Array.isArray(record.pendencias)
      ? (record.pendencias as RematriculaPendingSummary[])
      : [],
    excecoes: Array.isArray(record.excecoes)
      ? (record.excecoes as RematriculaExceptionSummary[])
      : [],
    comunicacoes: Array.isArray(record.comunicacoes)
      ? (record.comunicacoes as RematriculaCommunicationSummary[])
      : [],
    createdAt: parseDate(record.createdAt) ?? new Date().toISOString(),
    updatedAt: parseDate(record.updatedAt) ?? new Date().toISOString(),
  };
}

function parseNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseOptionalNumber(value: unknown): number | null {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  }
  return fallback;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseFormaPagamento(value: unknown): FormaPagamentoValue | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase();
  if (
    normalized === 'BOLETO' ||
    normalized === 'PIX' ||
    normalized === 'CARTAO_CREDITO' ||
    normalized === 'INDEFINIDO'
  ) {
    return normalized as FormaPagamentoValue;
  }
  return null;
}

function normalizeDescontos(raw: unknown): RematriculaDescontoResumoDTO[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      if (!record.id) return null;
      return {
        id: String(record.id),
        nome: record.nome ? String(record.nome) : 'Desconto',
      };
    })
    .filter((item): item is RematriculaDescontoResumoDTO => Boolean(item));
}

function normalizeFinanceiro(raw: unknown): RematriculaFinanceiro {
  const record = (raw as Record<string, unknown>) || {};
  return {
    pendencias: parseNumber(record.pendencias, 0),
    cobrancasEmAberto: parseNumber(record.cobrancasEmAberto, 0),
    cobrancasAtrasadas: parseNumber(record.cobrancasAtrasadas, 0),
    financialStatus:
      typeof record.financialStatus === 'string'
        ? (record.financialStatus as RematriculaFinanceiro['financialStatus'])
        : 'REGULAR',
    rematriculaActionStatus:
      typeof record.rematriculaActionStatus === 'string'
        ? (record.rematriculaActionStatus as RematriculaFinanceiro['rematriculaActionStatus'])
        : 'LIBERADA',
    blockReason:
      typeof record.blockReason === 'string'
        ? (record.blockReason as RematriculaFinanceiro['blockReason'])
        : 'SEM_BLOQUEIO',
    actionMessage: typeof record.actionMessage === 'string' ? record.actionMessage : '',
    canCurrentUserOverride: parseBoolean(record.canCurrentUserOverride, false),
    requiresOverrideReason: parseBoolean(record.requiresOverrideReason, false),
    shouldBlockNewFinancialCycle: parseBoolean(record.shouldBlockNewFinancialCycle, false),
    formaPagamento: parseFormaPagamento(record.formaPagamento),
    formaPagamentoTaxa: parseFormaPagamento(record.formaPagamentoTaxa),
    vencimentoDia: parseOptionalNumber(record.vencimentoDia),
    taxaMatricula: parseOptionalNumber(record.taxaMatricula),
    taxaIsenta: parseBoolean(record.taxaIsenta, false),
    taxaJustificativa:
      typeof record.taxaJustificativa === 'string' && record.taxaJustificativa.length
        ? record.taxaJustificativa
        : null,
    multaPercentual: parseOptionalNumber(record.multaPercentual),
    jurosMensal: parseOptionalNumber(record.jurosMensal),
    descontoAntecipado: parseOptionalNumber(record.descontoAntecipado),
    prazoDesconto: parseOptionalNumber(record.prazoDesconto),
    diasTolerancia: parseOptionalNumber(record.diasTolerancia),
    descontos: normalizeDescontos(record.descontos),
  };
}

function normalizeAluno(raw: unknown): RematriculaAluno {
  const record = (raw as Record<string, unknown>) || {};
  return {
    id: String(record.id ?? ''),
    nome: (record.nome as string | null) ?? null,
    cpf: (record.cpf as string | null) ?? null,
    foto: (record.foto as string | null) ?? null,
  };
}

function normalizeResponsavel(raw: unknown): RematriculaResponsavel | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!record.id) return null;
  return {
    id: String(record.id ?? ''),
    nome: (record.nome as string | null) ?? null,
    cpf: (record.cpf as string | null) ?? null,
    email: (record.email as string | null) ?? null,
    telefone: (record.telefone as string | null) ?? null,
    foto: (record.foto as string | null) ?? null,
  };
}

function normalizePlano(raw: unknown): RematriculaPlano {
  const record = (raw as Record<string, unknown>) || {};
  return {
    id: String(record.id ?? ''),
    nome: String(record.nome ?? ''),
  };
}

function normalizeTurma(raw: unknown): RematriculaTurma | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return {
    id: String(record.id ?? ''),
    nome: String(record.nome ?? ''),
    diasSemana: Array.isArray(record.diasSemana) ? (record.diasSemana as string[]) : [],
    horaInicio: String(record.horaInicio ?? ''),
    horaFim: String(record.horaFim ?? ''),
  };
}

function normalizeCombo(raw: unknown): RematriculaCombo | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return {
    id: String(record.id ?? ''),
    nome: String(record.nome ?? ''),
  };
}

function normalizeItem(raw: unknown): RematriculaElegivelItem {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Item de rematrícula inválido recebido da API.');
  }

  const record = raw as Record<string, unknown>;
  const dataFimContrato = parseDate(record.dataFimContrato) ?? new Date().toISOString();

  return rematriculaItemDTOSchema.parse({
    id: String(record.id ?? ''),
    matriculaFamiliarId: record.matriculaFamiliarId ? String(record.matriculaFamiliarId) : null,
    status: (record.status as MatriculaStatus) ?? 'ATIVA',
    statusContrato: (record.statusContrato as StatusContrato) ?? 'AGUARDANDO_ASSINATURA',
    dataInicio: parseDate(record.dataInicio) ?? new Date().toISOString(),
    dataFimContrato,
    diasRestantes: parseNumber(record.diasRestantes ?? 0, 0),
    contratoExpirado: parseBoolean(record.contratoExpirado, false),
    podeRenovar: parseBoolean(record.podeRenovar, false),
    eligibilityStatus:
      typeof record.eligibilityStatus === 'string'
        ? (record.eligibilityStatus as RematriculaElegivelItem['eligibilityStatus'])
        : 'ELEGIVEL',
    aluno: normalizeAluno(record.aluno),
    responsavelFinanceiro: normalizeResponsavel(record.responsavelFinanceiro),
    plano: normalizePlano(record.plano),
    turma: normalizeTurma(record.turma),
    combo: normalizeCombo(record.combo),
    financeiro: normalizeFinanceiro(record.financeiro),
  });
}

export async function listRematriculasElegiveisRequest(
  params: ListRematriculasParams,
): Promise<ListRematriculasResponse> {
  const searchParams = new URLSearchParams({ contaId: params.contaId });
  if (params.search) searchParams.set('q', params.search);
  if (params.diasAntecedencia)
    searchParams.set('diasAntecedencia', String(params.diasAntecedencia));
  if (params.statusContrato) searchParams.set('statusContrato', params.statusContrato);
  if (params.referencia) searchParams.set('referencia', params.referencia);
  if (params.targetPeriodId) searchParams.set('targetPeriodId', params.targetPeriodId);

  const response = await fetch(`/api/rematriculas?${searchParams.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível carregar as rematrículas elegíveis.',
    );
  }

  const parsed = listRematriculasResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inválida ao carregar rematrículas.');
  }
  return {
    ...parsed.data,
    itens: parsed.data.itens.map((item) => normalizeItem(item)),
    campaigns: Array.isArray((json as Record<string, unknown>)?.campaigns)
      ? ((json as Record<string, unknown>).campaigns as unknown[]).map(normalizeCampaign)
      : [],
    participants: Array.isArray((json as Record<string, unknown>)?.participants)
      ? ((json as Record<string, unknown>).participants as unknown[]).map(normalizeParticipant)
      : [],
    processes: Array.isArray((json as Record<string, unknown>)?.processes)
      ? ((json as Record<string, unknown>).processes as unknown[]).map(normalizeProcess)
      : [],
    history: Array.isArray((json as Record<string, unknown>)?.history)
      ? ((json as Record<string, unknown>).history as unknown[]).map(normalizeProcess)
      : [],
  };
}

export interface CreateRematriculaInput {
  contaId: string;
  campaignId?: string | null;
  targetPeriodId?: string;
  matriculaId: string;
  dataInicio: string;
  dataFimContrato: string;
  planoId?: string;
  turmaId?: string | null;
  comboId?: string | null;
  contractModelId?: string | null;
  responsavelFinanceiroId?: string | null;
  formaPagamento?: string;
  formaPagamentoTaxa?: string;
  vencimentoDia?: number;
  billingMode?: 'INDIVIDUAL' | 'SHARED_PLAN';
  valorMensalidadeOverride?: number;
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  taxaJustificativa?: string;
  criarCobranca?: boolean;
  descontos?: Array<{ id: string; cumulativo?: boolean }>;
  multaPercentual?: number;
  jurosMensal?: number;
  diasTolerancia?: number;
  descontoAntecipado?: number;
  prazoDesconto?: number;
  overrideReason?: string;
  futureBillingStrategy?: {
    mode: 'SEPARATE' | 'UNIFY_EXISTING';
    agreementId?: string | null;
  };
}

export interface IndividualRematriculaPreviewResponse {
  blockers: Array<{ sourceEnrollmentId: string; code: string; message: string }>;
  futureAgreementCandidates: Array<{
    id: string;
    source: 'FUTURE_AGREEMENT' | 'BILLING_AGREEMENT' | 'LEGACY_FAMILY' | 'CURRENT_INDIVIDUAL';
    processId: string;
    status: string;
    monthlyTotal: number;
    enrollmentFeeTotal: number;
    effectiveAt: string;
    periodicity: string | null;
    studentNames: string[];
    canUnify: boolean;
    reason: string | null;
  }>;
}

export async function previewIndividualRematriculaRequest(
  input: CreateRematriculaInput,
): Promise<IndividualRematriculaPreviewResponse> {
  const response = await fetch('/api/rematriculas/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      origin: 'STANDALONE',
      targetPeriodId: input.targetPeriodId,
      holderType: input.responsavelFinanceiroId ? 'RESPONSIBLE' : 'STUDENT',
      holderId: input.responsavelFinanceiroId ?? input.matriculaId,
      futureBillingStrategy: input.futureBillingStrategy,
      descontos: input.descontos ?? [],
      items: [{
        decision: 'RENEW',
        sourceEnrollmentId: input.matriculaId,
        target: {
          type: input.comboId ? 'COMBO' : 'CLASS',
          targetId: input.comboId ?? input.turmaId,
          planId: input.planoId,
        },
      }],
      effectiveAt: input.dataInicio,
      targetContractEndsAt: input.dataFimContrato,
      financialTerms: {
        earlyDiscountPercent: input.descontoAntecipado ?? null,
        earlyDiscountDays: input.prazoDesconto ?? null,
      },
    }),
  });
  const payload = await response.json().catch(() => null) as Partial<IndividualRematriculaPreviewResponse> | null;
  if (!response.ok) throw new Error(String((payload as { error?: { message?: string } } | null)?.error?.message ?? 'Não foi possível verificar cobranças futuras.'));
  return {
    blockers: Array.isArray(payload?.blockers) ? payload!.blockers : [],
    futureAgreementCandidates: Array.isArray(payload?.futureAgreementCandidates) ? payload!.futureAgreementCandidates : [],
  };
}

export interface CreateRematriculaResponse {
  operationId: string;
  status: 'PENDING' | 'PENDING_FINANCE' | 'COMMITTED';
  matriculaId: string;
  message: string;
  novaMatricula: {
    id: string;
    planoId: string;
    turmaId: string | null;
    status: MatriculaStatus;
    statusContrato: StatusContrato;
    dataInicio: string;
    dataFimContrato: string;
    asaasSubscriptionId: string | null;
  };
  historicoContrato: {
    dataInicioAnterior: string;
    dataFimContratoAnterior: string;
    turmaIdAnterior: string | null;
    planoIdAnterior: string;
  };
  primeiroVencimento: string;
  responsavelFinanceiro: RematriculaAluno | null;
}

export async function createRematriculaRequest(
  input: CreateRematriculaInput,
): Promise<CreateRematriculaResponse> {
  const response = await fetch('/api/rematriculas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível confirmar o próximo ciclo.',
    );
  }

  const parsed = createRematriculaResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inválida ao confirmar o próximo ciclo.');
  }

  const payload = parsed.data;
  return {
    operationId: payload.operationId,
    status: payload.status,
    matriculaId: payload.matriculaId,
    message: payload.message,
    novaMatricula: payload.novaMatricula,
    historicoContrato: payload.historicoContrato,
    primeiroVencimento: payload.primeiroVencimento,
    responsavelFinanceiro: payload.responsavelFinanceiro,
  };
}

export type RematriculaFamiliarModoTurmas = 'TURMAS' | 'COMBO';
export type RematriculaFamiliarDecision =
  | 'REMATRICULAR_AGORA'
  | 'NAO_CONTINUARA'
  | 'DECIDIR_DEPOIS'
  | 'TRANSFERIR_MODALIDADE'
  | 'ALTERAR_PAGADOR'
  | 'REMATRICULAR_SEPARADAMENTE';

export interface RematriculaFamiliarItemInput {
  matriculaId: string;
  decision: RematriculaFamiliarDecision;
  turmaId?: string | null;
  /** Em modo COMBO, combo por aluno (alternativa ao combo global). */
  comboId?: string | null;
  decisionReason?: string | null;
}

export interface CreateRematriculaFamiliarInput {
  contaId: string;
  campaignId?: string | null;
  targetPeriodId?: string;
  responsavelId: string;
  novoResponsavelId?: string | null;
  futureBillingStrategy?: {
    mode: 'SEPARATE' | 'UNIFY_EXISTING';
    agreementId?: string | null;
  };
  /**
   * Define qual produto financeiro vai consolidar a cobrança familiar:
   * - `TURMAS`: requer `planoId` global e `turmaId` por item.
   * - `COMBO`: `comboId` em cada item e/ou `comboId` global (itens sem combo herdam o global).
   */
  modoTurmas: RematriculaFamiliarModoTurmas;
  /** Plano global aplicado a todos os itens em modo TURMAS. */
  planoId?: string | null;
  /** Combo global em modo COMBO (opcional se cada item tiver `comboId`). */
  comboId?: string | null;
  itens: RematriculaFamiliarItemInput[];
  dataInicio: string;
  dataFimContrato: string;
  formaPagamento: Exclude<FormaPagamentoValue, 'INDEFINIDO'>;
  formaPagamentoTaxa?: Exclude<FormaPagamentoValue, 'INDEFINIDO'>;
  vencimentoDia: number;
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  taxaJustificativa?: string;
  descontos?: Array<{ id: string; cumulativo?: boolean }>;
  multaPercentual?: number;
  jurosMensal?: number;
  descontoAntecipado?: number;
  prazoDesconto?: number;
  overrideReason?: string;
  notificationChannels?: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>;
  notificationChannelsConfigured?: boolean;
  contratoModeloId?: string | null;
  previewId?: string | null;
  previewHash?: string | null;
  sourceVersion?: string | null;
  uiRequestId?: string;
}

export interface CreateRematriculaFamiliarResponse {
  familyId: string;
  transitionId?: string;
  status: string;
  step?: string | null;
  academicStatus?: string | null;
  sourceBillingStatus?: string | null;
  targetBillingStatus?: string | null;
  contractStatus?: string | null;
  previewHash?: string | null;
  sourceVersion?: string | null;
  warnings?: string[];
  results: Array<{
    matriculaId: string;
    alunoId: string;
    alunoNome: string;
    decision?: RematriculaFamiliarDecision;
    status: 'success' | 'pending' | 'error';
    novaMatriculaId?: string | null;
    errorMessage?: string | null;
  }>;
}

export interface RematriculaFamiliarPreviewResponse {
  previewId: string;
  previewHash: string;
  sourceVersion: string;
  blocks: Array<{ sourceEnrollmentId: string; code: string; message: string }>;
  warnings: string[];
  sourceBillingAction: string;
  financialGroups: Array<{
    compatibilityKey: string;
    totalAmount: number;
    items: Array<{ sourceEnrollmentId: string; alunoNome: string; amount: number }>;
  }>;
  futureAgreementCandidates: Array<{
    id: string;
    source: 'FUTURE_AGREEMENT' | 'BILLING_AGREEMENT' | 'LEGACY_FAMILY' | 'CURRENT_INDIVIDUAL';
    processId: string;
    status: string;
    monthlyTotal: number;
    enrollmentFeeTotal: number;
    effectiveAt: string;
    periodicity: string | null;
    studentNames: string[];
    canUnify: boolean;
    reason: string | null;
  }>;
}

export async function previewRematriculaFamiliarRequest(
  input: CreateRematriculaFamiliarInput,
): Promise<RematriculaFamiliarPreviewResponse> {
  const requestBody = buildRematriculaFamiliarRequestBody(input);

  const response = await fetch('/api/rematriculas/familiar/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      parseRematriculaFamiliarApiError(
        json,
        'Não foi possível gerar o preview da rematrícula familiar.',
      ),
    );
  }

  const payload = json as Partial<RematriculaFamiliarPreviewResponse>;
  return {
    previewId: String(payload.previewId ?? ''),
    previewHash: String(payload.previewHash ?? ''),
    sourceVersion: String(payload.sourceVersion ?? ''),
    blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    sourceBillingAction: String(payload.sourceBillingAction ?? ''),
    financialGroups: Array.isArray(payload.financialGroups) ? payload.financialGroups : [],
    futureAgreementCandidates: Array.isArray(payload.futureAgreementCandidates)
      ? payload.futureAgreementCandidates as RematriculaFamiliarPreviewResponse['futureAgreementCandidates']
      : [],
  };
}

function normalizeOptionalId(value?: string | null) {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;
  return trimmed;
}

function parseRematriculaFamiliarApiError(json: unknown, fallback: string) {
  const payload = json as {
    error?: { code?: string; message?: string; details?: ZodIssue[] };
  } | null;
  if (!payload?.error) return fallback;

  const { code, message, details } = payload.error;
  if (code === 'PAYLOAD_INVALIDO' && Array.isArray(details)) {
    return formatRematriculaFamiliarValidationMessage(details);
  }

  return message ?? fallback;
}

function buildRematriculaFamiliarRequestBody(input: CreateRematriculaFamiliarInput) {
  const isCombo = input.modoTurmas === 'COMBO';
  const planoId = !isCombo ? normalizeOptionalId(input.planoId) : null;
  const comboIdGlobal = isCombo ? normalizeOptionalId(input.comboId) : null;

  const body: Record<string, unknown> = {
    contaId: input.contaId,
    campaignId: normalizeOptionalId(input.campaignId),
    targetPeriodId: input.targetPeriodId,
    responsavelId: input.responsavelId,
    novoResponsavelId: normalizeOptionalId(input.novoResponsavelId),
    futureBillingStrategy: input.futureBillingStrategy ?? { mode: 'SEPARATE', agreementId: null },
    itens: input.itens.map((item) => ({
      matriculaId: item.matriculaId,
      decision: item.decision ?? 'DECIDIR_DEPOIS',
      decisionReason: normalizeOptionalId(item.decisionReason),
      turmaId: normalizeOptionalId(item.turmaId),
      planoId: !isCombo ? planoId : null,
      comboId: isCombo ? normalizeOptionalId(item.comboId) ?? comboIdGlobal : null,
    })),
    dataInicio: input.dataInicio,
    dataFimContrato: input.dataFimContrato,
    formaPagamento: input.formaPagamento,
    formaPagamentoTaxa: input.formaPagamentoTaxa,
    vencimentoDia: input.vencimentoDia,
    taxaMatricula: input.taxaIsenta ? 0 : (input.taxaMatricula ?? 0),
    taxaIsenta: input.taxaIsenta ?? false,
    descontos: input.descontos ?? [],
    notificationChannels: input.notificationChannels ?? [],
    notificationChannelsConfigured: input.notificationChannelsConfigured ?? false,
    contratoModeloId: normalizeOptionalId(input.contratoModeloId),
    uiRequestId: input.uiRequestId ?? `${input.responsavelId}:${Date.now()}`,
  };

  if (input.taxaJustificativa?.trim()) {
    body.taxaJustificativa = input.taxaJustificativa.trim();
  }
  if (input.multaPercentual != null) body.multaPercentual = input.multaPercentual;
  if (input.jurosMensal != null) body.jurosMensal = input.jurosMensal;
  if (input.descontoAntecipado != null) body.descontoAntecipado = input.descontoAntecipado;
  if (input.prazoDesconto != null) body.prazoDesconto = input.prazoDesconto;
  if (input.overrideReason?.trim()) body.overrideReason = input.overrideReason.trim();
  if (input.previewId) body.previewId = input.previewId;
  if (input.previewHash) body.previewHash = input.previewHash;
  if (input.sourceVersion) body.sourceVersion = input.sourceVersion;

  return body;
}

export async function createRematriculaFamiliarRequest(
  input: CreateRematriculaFamiliarInput,
): Promise<CreateRematriculaFamiliarResponse> {
  const requestBody = buildRematriculaFamiliarRequestBody(input);

  const response = await fetch('/api/rematriculas/familiar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      parseRematriculaFamiliarApiError(json, 'Não foi possível confirmar o próximo ciclo familiar.'),
    );
  }

  const payload = json as Partial<CreateRematriculaFamiliarResponse>;
  return {
    familyId: String(payload.familyId ?? ''),
    transitionId: payload.transitionId ? String(payload.transitionId) : undefined,
    status: String(payload.status ?? ''),
    step: payload.step ? String(payload.step) : null,
    academicStatus: payload.academicStatus ? String(payload.academicStatus) : null,
    sourceBillingStatus: payload.sourceBillingStatus ? String(payload.sourceBillingStatus) : null,
    targetBillingStatus: payload.targetBillingStatus ? String(payload.targetBillingStatus) : null,
    contractStatus: payload.contractStatus ? String(payload.contractStatus) : null,
    previewHash: payload.previewHash ? String(payload.previewHash) : null,
    sourceVersion: payload.sourceVersion ? String(payload.sourceVersion) : null,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    results: Array.isArray(payload.results)
      ? payload.results.map((result) => ({
          matriculaId: String(result.matriculaId ?? ''),
          alunoId: String(result.alunoId ?? ''),
          alunoNome: String(result.alunoNome ?? ''),
          decision: result.decision,
          status:
            result.status === 'error' ? 'error' : result.status === 'pending' ? 'pending' : 'success',
          novaMatriculaId: result.novaMatriculaId ? String(result.novaMatriculaId) : null,
          errorMessage: result.errorMessage ? String(result.errorMessage) : null,
        }))
      : [],
  };
}

export interface CreateRematriculaCampaignInput {
  nome: string;
  descricao?: string | null;
  targetPeriodId: string;
  campaignStartsAt: string;
  campaignEndsAt?: string | null;
  audienceDefinition?: Record<string, unknown> | null;
}

export async function createRematriculaCampaignRequest(
  input: CreateRematriculaCampaignInput,
): Promise<RematriculaCampaignSummary> {
  const response = await fetch('/api/rematriculas/campanhas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível criar a campanha.',
    );
  }
  return normalizeCampaign((json as { campaign?: unknown })?.campaign);
}

export async function updateRematriculaCampaignRequest(
  campaignId: string,
  input: Partial<CreateRematriculaCampaignInput> & {
    status?: RematriculaCampaignSummary['status'];
  },
): Promise<RematriculaCampaignSummary> {
  const response = await fetch(`/api/rematriculas/campanhas/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível atualizar a campanha.',
    );
  }
  return normalizeCampaign((json as { campaign?: unknown })?.campaign);
}

export async function deleteRematriculaCampaignRequest(
  campaignId: string,
): Promise<{ deleted: boolean; mode: 'HARD_DELETE' | 'SOFT_DELETE'; campaignId: string }> {
  const response = await fetch(`/api/rematriculas/campanhas/${campaignId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível excluir a campanha.',
    );
  }
  return json as { deleted: boolean; mode: 'HARD_DELETE' | 'SOFT_DELETE'; campaignId: string };
}

export async function activateRematriculaCampaignRequest(
  campaignId: string,
): Promise<{ campaign: RematriculaCampaignSummary; createdParticipants: number }> {
  const response = await fetch(`/api/rematriculas/campanhas/${campaignId}/activate`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível ativar a campanha.',
    );
  }
  return {
    campaign: normalizeCampaign((json as { campaign?: unknown })?.campaign),
    createdParticipants: parseNumber((json as { createdParticipants?: unknown })?.createdParticipants, 0),
  };
}

export async function cancelRematriculaProcessRequest(
  processId: string,
  reason: string,
): Promise<RematriculaCancelResult> {
  const response = await fetch(`/api/rematriculas/${processId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível cancelar o próximo ciclo.',
    );
  }
  return json as RematriculaCancelResult;
}

export async function editRematriculaFutureLinkRequest(
  processId: string,
  input: {
    targetClassId?: string | null;
    targetComboId?: string | null;
    targetPlanId?: string | null;
    holderType?: 'STUDENT' | 'RESPONSIBLE' | null;
    holderId?: string | null;
    effectiveAt?: string | null;
    firstDueDate?: string | null;
    targetContractEndsAt?: string | null;
    contractModelId?: string | null;
    paymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
    enrollmentFeePaymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
    dueDay?: number | null;
    enrollmentFeeAmount?: number | null;
    enrollmentFeeExempt?: boolean | null;
    enrollmentFeeJustification?: string | null;
    feeChargeMoment?: 'CHARGE_ON_CONFIRMATION' | 'CHARGE_ON_START' | 'EXEMPT' | null;
    feeUnit?: 'NO_FEE' | 'PER_STUDENT' | 'PER_FAMILY' | null;
    feePurpose?: 'ADMINISTRATIVE_FEE' | 'SEAT_RESERVATION' | 'ADVANCE_FIRST_TUITION' | null;
    monthlyAmount?: number | null;
    lateFeePercent?: number | null;
    interestMonthlyPercent?: number | null;
    earlyDiscountPercent?: number | null;
    earlyDiscountDays?: number | null;
    reason: string;
  },
) {
  const response = await fetch(`/api/rematriculas/${processId}/future-link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível editar o próximo ciclo.',
    );
  }
  return json;
}

export async function resolveRematriculaPendingRequest(
  pendingId: string,
  input: { resolution: string; status?: 'RESOLVED' | 'DISMISSED' },
) {
  const response = await fetch(`/api/rematriculas/pendencias/${pendingId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível resolver a pendência.',
    );
  }
  return json;
}

export async function grantRematriculaExceptionRequest(
  processId: string,
  input: {
    itemId?: string | null;
    permission: string;
    rule: string;
    impact: string;
    justification: string;
  },
) {
  const response = await fetch(`/api/rematriculas/processos/${processId}/exceptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível conceder a exceção.',
    );
  }
  return json;
}

export async function createRematriculaCommunicationRequest(
  processId: string,
  input: {
    channel: 'EMAIL' | 'WHATSAPP' | 'SMS' | 'PORTAL';
    audience: string;
    subject?: string | null;
    message: string;
    scheduledAt?: string | null;
  },
) {
  const response = await fetch(`/api/rematriculas/processos/${processId}/communications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível registrar a comunicação.',
    );
  }
  return json;
}
