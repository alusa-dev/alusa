import type { MatriculaStatus } from '@/features/cadastro/matriculas/services/matriculas-service';
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
  type RematriculaStatusContratoDTO as StatusContrato,
  type RematriculaTurmaDTO as RematriculaTurma,
} from '../dtos';

export type {
  FormaPagamentoValue,
  RematriculaElegivelItem,
  StatusContrato,
};

export interface ListRematriculasParams {
  contaId: string;
  diasAntecedencia?: number;
  statusContrato?: StatusContrato;
  referencia?: string;
  search?: string;
  signal?: AbortSignal;
}

export interface ListRematriculasResponse {
  referencia: string;
  ate: string;
  total: number;
  itens: RematriculaElegivelItem[];
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
  if (normalized === 'BOLETO' || normalized === 'PIX' || normalized === 'CARTAO_CREDITO' || normalized === 'INDEFINIDO') {
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
      typeof record.financialStatus === 'string' ? record.financialStatus as RematriculaFinanceiro['financialStatus'] : 'REGULAR',
    rematriculaActionStatus:
      typeof record.rematriculaActionStatus === 'string'
        ? record.rematriculaActionStatus as RematriculaFinanceiro['rematriculaActionStatus']
        : 'LIBERADA',
    blockReason:
      typeof record.blockReason === 'string' ? record.blockReason as RematriculaFinanceiro['blockReason'] : 'SEM_BLOQUEIO',
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
    diasSemana: Array.isArray(record.diasSemana)
      ? (record.diasSemana as string[])
      : [],
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
    status: (record.status as MatriculaStatus) ?? 'ATIVA',
    statusContrato: (record.statusContrato as StatusContrato) ?? 'AGUARDANDO_ASSINATURA',
    dataInicio: parseDate(record.dataInicio) ?? new Date().toISOString(),
    dataFimContrato,
    diasRestantes: parseNumber(record.diasRestantes ?? 0, 0),
    contratoExpirado: parseBoolean(record.contratoExpirado, false),
    podeRenovar: parseBoolean(record.podeRenovar, false),
    eligibilityStatus:
      typeof record.eligibilityStatus === 'string'
        ? record.eligibilityStatus as RematriculaElegivelItem['eligibilityStatus']
        : 'ELEGIVEL',
    aluno: normalizeAluno(record.aluno),
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
  if (params.diasAntecedencia) searchParams.set('diasAntecedencia', String(params.diasAntecedencia));
  if (params.statusContrato) searchParams.set('statusContrato', params.statusContrato);
  if (params.referencia) searchParams.set('referencia', params.referencia);

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
  };
}

export interface CreateRematriculaInput {
  contaId: string;
  matriculaId: string;
  dataInicio: string;
  dataFimContrato: string;
  planoId?: string;
  turmaId?: string | null;
  comboId?: string | null;
  responsavelFinanceiroId?: string | null;
  formaPagamento?: string;
  formaPagamentoTaxa?: string;
  vencimentoDia?: number;
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
        'Não foi possível concluir a rematrícula.',
    );
  }

  const parsed = createRematriculaResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inválida ao concluir a rematrícula.');
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
