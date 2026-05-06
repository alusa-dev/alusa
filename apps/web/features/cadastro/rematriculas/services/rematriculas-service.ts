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

export type RematriculaFamiliarModoTurmas = 'TURMAS' | 'COMBO';

export interface RematriculaFamiliarItemInput {
  matriculaId: string;
  turmaId?: string | null;
  /** Em modo COMBO, combo por aluno (alternativa ao combo global). */
  comboId?: string | null;
}

export interface CreateRematriculaFamiliarInput {
  contaId: string;
  responsavelId: string;
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
  uiRequestId?: string;
}

export interface CreateRematriculaFamiliarResponse {
  familyId: string;
  status: string;
  results: Array<{
    matriculaId: string;
    alunoId: string;
    alunoNome: string;
    status: 'success' | 'error';
    novaMatriculaId?: string | null;
    errorMessage?: string | null;
  }>;
}

export async function createRematriculaFamiliarRequest(
  input: CreateRematriculaFamiliarInput,
): Promise<CreateRematriculaFamiliarResponse> {
  const isCombo = input.modoTurmas === 'COMBO';
  const planoId = !isCombo ? input.planoId ?? null : null;
  const comboIdGlobal = isCombo ? input.comboId ?? null : null;

  const requestBody = {
    ...input,
    planoId,
    comboId: comboIdGlobal,
    itens: input.itens.map((item) => ({
      matriculaId: item.matriculaId,
      turmaId: item.turmaId ?? null,
      planoId: !isCombo ? planoId : null,
      comboId: isCombo ? item.comboId ?? comboIdGlobal : null,
    })),
  };

  const response = await fetch('/api/rematriculas/familiar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível concluir a rematrícula familiar.',
    );
  }

  const payload = json as Partial<CreateRematriculaFamiliarResponse>;
  return {
    familyId: String(payload.familyId ?? ''),
    status: String(payload.status ?? ''),
    results: Array.isArray(payload.results)
      ? payload.results.map((result) => ({
          matriculaId: String(result.matriculaId ?? ''),
          alunoId: String(result.alunoId ?? ''),
          alunoNome: String(result.alunoNome ?? ''),
          status: result.status === 'success' ? 'success' : 'error',
          novaMatriculaId: result.novaMatriculaId ? String(result.novaMatriculaId) : null,
          errorMessage: result.errorMessage ? String(result.errorMessage) : null,
        }))
      : [],
  };
}
