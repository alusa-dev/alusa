import { FormaPagamento, StatusMatricula, StatusTaxaMatricula } from '@prisma/client';
import {
  createMatriculaInputDTOSchema,
  createMatriculaResultDTOSchema,
  editMatriculaResultDTOSchema,
  listMatriculasResultDTOSchema,
  matriculaCoreDTOSchema,
  matriculaDeleteResultDTOSchema,
  matriculaGerarPixResultDTOSchema,
  matriculaReenviarCobrancaResultDTOSchema,
  matriculaResumoDTOSchema,
  matriculaStatusSyncResultDTOSchema,
  matriculaSubscriptionBillingTypeUpdateResultDTOSchema,
  matriculaNotificationChannelsResultDTOSchema,
  matriculaSubscriptionTermsUpdateResultDTOSchema,
  matriculaSubscriptionValueUpdateResultDTOSchema,
  type CreateMatriculaInputDTO,
  type MatriculaAdjustmentTypeDTO,
  type MatriculaBillingTypeDTO,
  type MatriculaDeleteResultDTO,
  type MatriculaReenviarCobrancaResultDTO,
} from './dtos';

type Nullable<T> = T | null | undefined;

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toNumber(value: unknown, fallback?: number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback ?? null;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  }
  return fallback;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

export function normalizeFormaPagamentoInput(raw: unknown): FormaPagamento | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  const normalized = raw.trim().toUpperCase();
  const mapping: Record<string, FormaPagamento> = {
    CARTAO: FormaPagamento.CARTAO_CREDITO,
    CARTAO_CREDITO: FormaPagamento.CARTAO_CREDITO,
    PIX: FormaPagamento.PIX,
    BOLETO: FormaPagamento.BOLETO,
    DINHEIRO: FormaPagamento.INDEFINIDO,
    INDEFINIDO: FormaPagamento.INDEFINIDO,
  };

  const mapped = mapping[normalized];
  return mapped && Object.values(FormaPagamento).includes(mapped) ? mapped : undefined;
}

function mapCobrancaRecordToDTO(cobranca: Record<string, unknown>) {
  return {
    id: String(cobranca.id ?? ''),
    valor: Number(cobranca.valor ?? 0),
    status: cobranca.status,
    formaPagamento: cobranca.formaPagamento,
    tipo: cobranca.tipo,
    vencimento:
      toIsoString(cobranca.vencimento as Nullable<Date | string>) ?? new Date(0).toISOString(),
    descricao: cobranca.descricao ? String(cobranca.descricao) : null,
    asaasPaymentId: cobranca.asaasPaymentId ? String(cobranca.asaasPaymentId) : null,
    asaasId: cobranca.asaasId ? String(cobranca.asaasId) : null,
    createdAt:
      toIsoString(cobranca.createdAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    competenciaInicio:
      toIsoString(cobranca.competenciaInicio as Nullable<Date | string>) ??
      new Date(0).toISOString(),
    competenciaFim:
      toIsoString(cobranca.competenciaFim as Nullable<Date | string>) ?? new Date(0).toISOString(),
    dataPagamento: toIsoString(cobranca.dataPagamento as Nullable<Date | string>),
    origin: cobranca.origin === 'STANDALONE' ? 'STANDALONE' : 'ACADEMIC',
  };
}

function mapContratoRecordToDTO(contrato: Record<string, unknown>) {
  const template = (contrato.modelo as Nullable<Record<string, unknown>>) ?? null;

  return {
    id: String(contrato.id ?? ''),
    status: contrato.status,
    tokenPublico: String(contrato.tokenPublico ?? ''),
    createdAt:
      toIsoString(contrato.createdAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    tokenExpiraEm: toIsoString(contrato.tokenExpiraEm as Nullable<Date | string>),
    template: template ? { nome: String(template.nome ?? '') } : undefined,
  };
}

export function mapMatriculaRecordToResumoDTO(matricula: Record<string, unknown>) {
  const aluno = (matricula.aluno as Nullable<Record<string, unknown>>) ?? {};
  const plano = (matricula.plano as Nullable<Record<string, unknown>>) ?? null;
  const turma = (matricula.turma as Nullable<Record<string, unknown>>) ?? null;
  const combo = (matricula.combo as Nullable<Record<string, unknown>>) ?? null;
  const responsavel =
    (matricula.responsavelFinanceiro as Nullable<Record<string, unknown>>) ?? null;
  const turmas = Array.isArray(matricula.turmas)
    ? (matricula.turmas as Record<string, unknown>[])
    : Array.isArray(matricula.matriculaTurmas)
      ? ((matricula.matriculaTurmas as Record<string, unknown>[])
          .map((item) => (item.turma as Nullable<Record<string, unknown>>) ?? null)
          .filter(Boolean) as Record<string, unknown>[])
      : [];

  const dto = {
    id: String(matricula.id ?? ''),
    status: matricula.status,
    statusFinanceiro: matricula.statusFinanceiro ?? null,
    statusContrato: matricula.statusContrato ?? null,
    dataInicio:
      toIsoString(matricula.dataInicio as Nullable<Date | string>) ?? new Date(0).toISOString(),
    dataFimContrato: toIsoString(matricula.dataFimContrato as Nullable<Date | string>),
    taxaMatricula: Number(matricula.taxaMatricula ?? 0),
    taxaStatus: matricula.taxaStatus ?? StatusTaxaMatricula.PENDENTE,
    taxaIsenta: Boolean(matricula.taxaIsenta),
    vencimentoDia: Number(matricula.vencimentoDia ?? 0),
    aluno: {
      id: String(aluno.id ?? ''),
      nome: aluno.nome ? String(aluno.nome) : null,
      cpf: aluno.cpf ? String(aluno.cpf) : null,
    },
    plano: plano
      ? {
          id: String(plano.id ?? ''),
          nome: String(plano.nome ?? ''),
          valor: Number(plano.valor ?? 0),
        }
      : null,
    responsavelFinanceiro: responsavel
      ? {
          id: String(responsavel.id ?? ''),
          nome: String(responsavel.nome ?? ''),
          email: responsavel.email ? String(responsavel.email) : null,
          telefone: responsavel.telefone ? String(responsavel.telefone) : null,
        }
      : null,
    turma: turma
      ? {
          id: String(turma.id ?? ''),
          nome: String(turma.nome ?? ''),
          diasSemana: Array.isArray(turma.diasSemana) ? (turma.diasSemana as string[]) : [],
          horaInicio: String(turma.horaInicio ?? ''),
          horaFim: String(turma.horaFim ?? ''),
        }
      : null,
    turmas: turmas.map((item) => ({
      id: String(item.id ?? ''),
      nome: String(item.nome ?? ''),
      diasSemana: Array.isArray(item.diasSemana) ? (item.diasSemana as string[]) : [],
      horaInicio: String(item.horaInicio ?? ''),
      horaFim: String(item.horaFim ?? ''),
    })),
    combo: combo
      ? {
          id: String(combo.id ?? ''),
          nome: String(combo.nome ?? ''),
        }
      : null,
    cobrancas: Array.isArray(matricula.cobrancas)
      ? (matricula.cobrancas as Record<string, unknown>[]).map((cobranca) =>
          mapCobrancaRecordToDTO(cobranca),
        )
      : [],
    contratos: Array.isArray(matricula.contratos)
      ? (matricula.contratos as Record<string, unknown>[]).map((contrato) =>
          mapContratoRecordToDTO(contrato),
        )
      : [],
    asaasSubscriptionId: matricula.asaasSubscriptionId
      ? String(matricula.asaasSubscriptionId)
      : null,
    pausaAtiva: Boolean(matricula.pausaAtiva),
    dataInicioPausa: toIsoString(matricula.dataInicioPausa as Nullable<Date | string>),
    dataRetornoPrevista: toIsoString(matricula.dataRetornoPrevista as Nullable<Date | string>),
    manterVaga: typeof matricula.manterVaga === 'boolean' ? Boolean(matricula.manterVaga) : true,
    cobrarDurantePausa:
      typeof matricula.cobrarDurantePausa === 'boolean'
        ? Boolean(matricula.cobrarDurantePausa)
        : false,
    motivoPausa: matricula.motivoPausa ? String(matricula.motivoPausa) : null,
    integrationStatus: matricula.integrationStatus
      ? String(matricula.integrationStatus)
      : 'SINCRONIZADO',
    warningCode: matricula.warningCode ? String(matricula.warningCode) : null,
    jurosMensal: toNumber(matricula.jurosMensal, null),
    jurosTipo: matricula.jurosTipo ? String(matricula.jurosTipo) : null,
    multaPercentual: toNumber(matricula.multaPercentual, null),
    multaTipo: matricula.multaTipo ? String(matricula.multaTipo) : null,
    descontoAntecipado: toNumber(matricula.descontoAntecipado, null),
    descontoTipo: matricula.descontoTipo ? String(matricula.descontoTipo) : null,
    prazoDesconto: toNumber(matricula.prazoDesconto, null),
    assinaturaSnapshot:
      matricula.assinaturaSnapshot && typeof matricula.assinaturaSnapshot === 'object'
        ? {
            asaasSubscriptionId: String(
              (matricula.assinaturaSnapshot as Record<string, unknown>).asaasSubscriptionId ?? '',
            ),
            status:
              ((matricula.assinaturaSnapshot as Record<string, unknown>).status as
                | 'ACTIVE'
                | 'INACTIVE'
                | 'EXPIRED'
                | undefined) ?? 'ACTIVE',
            billingType:
              ((matricula.assinaturaSnapshot as Record<string, unknown>).billingType as
                | MatriculaBillingTypeDTO
                | null
                | undefined) ?? null,
            value: toNumber((matricula.assinaturaSnapshot as Record<string, unknown>).value, null),
            nextDueDate: toIsoString(
              (matricula.assinaturaSnapshot as Record<string, unknown>).nextDueDate as Nullable<
                Date | string
              >,
            ),
            deleted: toBoolean(
              (matricula.assinaturaSnapshot as Record<string, unknown>).deleted,
              false,
            ),
            syncError:
              (matricula.assinaturaSnapshot as Record<string, unknown>).syncError != null
                ? String((matricula.assinaturaSnapshot as Record<string, unknown>).syncError)
                : null,
            syncedAt: toIsoString(
              (matricula.assinaturaSnapshot as Record<string, unknown>).syncedAt as Nullable<
                Date | string
              >,
            ),
          }
        : null,
  };

  return matriculaResumoDTOSchema.parse(dto);
}

export function mapListMatriculasResultToDTO(input: {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const items = input.data.map((matricula) => mapMatriculaRecordToResumoDTO(matricula));
  return listMatriculasResultDTOSchema.parse({
    matriculas: items,
    total: input.total,
    page: input.page,
    perPage: input.pageSize,
    totalPages: Math.ceil(input.total / input.pageSize),
    data: items,
    pageSize: input.pageSize,
  });
}

export function mapMatriculaRecordToCoreDTO(matricula: Record<string, unknown>) {
  return matriculaCoreDTOSchema.parse({
    id: String(matricula.id ?? ''),
    alunoId: String(matricula.alunoId ?? ''),
    responsavelFinanceiroId: matricula.responsavelFinanceiroId
      ? String(matricula.responsavelFinanceiroId)
      : null,
    planoId: matricula.planoId ? String(matricula.planoId) : null,
    turmaId: matricula.turmaId ? String(matricula.turmaId) : null,
    comboId: matricula.comboId ? String(matricula.comboId) : null,
    status: matricula.status ?? StatusMatricula.ATIVA,
    statusContrato: matricula.statusContrato ?? null,
    statusFinanceiro: matricula.statusFinanceiro ?? null,
    dataInicio:
      toIsoString(matricula.dataInicio as Nullable<Date | string>) ?? new Date(0).toISOString(),
    dataFimContrato: toIsoString(matricula.dataFimContrato as Nullable<Date | string>),
    taxaMatricula: Number(matricula.taxaMatricula ?? 0),
    taxaStatus: matricula.taxaStatus ?? StatusTaxaMatricula.PENDENTE,
    taxaIsenta: Boolean(matricula.taxaIsenta),
    taxaJustificativa: matricula.taxaJustificativa ? String(matricula.taxaJustificativa) : null,
    vencimentoDia: Number(matricula.vencimentoDia ?? 0),
    asaasId: matricula.asaasId ? String(matricula.asaasId) : null,
    asaasSubscriptionId: matricula.asaasSubscriptionId
      ? String(matricula.asaasSubscriptionId)
      : null,
    createdAt:
      toIsoString(matricula.createdAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
    updatedAt:
      toIsoString(matricula.updatedAt as Nullable<Date | string>) ?? new Date(0).toISOString(),
  });
}

export function mapCreateMatriculaDTOToServiceInput(input: {
  body: CreateMatriculaInputDTO;
  contaId: string;
  createdById: string;
}) {
  const parsed = createMatriculaInputDTOSchema.parse(input.body);
  const taxaMatriculaValue = toNumber(parsed.taxaMatricula, 0) ?? 0;
  const taxaIsentaValue = toBoolean(parsed.taxaIsenta, false);
  const pagarTaxaAgoraValue = toBoolean(parsed.pagarTaxaAgora, false);
  const gerarCobrancaTaxaValue = toBoolean(parsed.gerarCobrancaTaxa, false);
  const criarCobrancaValue = toBoolean(parsed.criarCobranca, true);
  const dataInicioValue = toDate(parsed.dataInicio) ?? new Date();
  const dataFimContratoValue = toDate(parsed.dataFimContrato);

  if (!dataFimContratoValue) {
    throw new Error('dataFimContrato é obrigatório.');
  }

  return {
    alunoId: parsed.alunoId,
    planoId: parsed.planoId ?? undefined,
    turmaId: parsed.turmaId ?? undefined,
    comboId: parsed.comboId ?? undefined,
    responsavelFinanceiroId: parsed.responsavelFinanceiroId ?? undefined,
    taxaJustificativa: parsed.taxaJustificativa ?? undefined,
    contaId: input.contaId,
    taxaMatricula: taxaMatriculaValue,
    taxaIsenta: taxaIsentaValue,
    pagarTaxaAgora: pagarTaxaAgoraValue,
    gerarCobrancaTaxa: gerarCobrancaTaxaValue,
    criarCobranca: criarCobrancaValue,
    billingMode: parsed.billingMode,
    valorMensalidadeOverride: toNumber(parsed.valorMensalidadeOverride, null),
    dataInicio: dataInicioValue,
    dataFimContrato: dataFimContratoValue,
    vencimento: toDate(parsed.vencimento),
    vencimentoDia: toNumber(parsed.vencimentoDia, 5) ?? 5,
    formaPagamento: normalizeFormaPagamentoInput(parsed.formaPagamento),
    formaPagamentoTaxa: normalizeFormaPagamentoInput(parsed.formaPagamentoTaxa),
    createdById: input.createdById,
    jurosMensal: toNumber(parsed.jurosMensal, null),
    multaPercentual: toNumber(parsed.multaPercentual, null),
    descontoAntecipado: toNumber(parsed.descontoAntecipado, null),
    descontoTipo: parsed.descontoTipo ?? 'PERCENTAGE',
    prazoDesconto: toNumber(parsed.prazoDesconto, null),
    descontoIds: parsed.descontoIds ?? [],
  };
}

export function mapCreateMatriculaResultToDTO(input: {
  result: {
    matricula: Record<string, unknown>;
    cobrancas: {
      taxa: Record<string, unknown> | null;
      mensalidade: Record<string, unknown> | null;
    };
    preco: {
      plano: number;
      planoLiquido: number;
      taxa: number;
      descontosAplicados: number[];
      total: number;
    };
    responsavelFinanceiro: Record<string, unknown> | null;
    primeiroVencimento: Date;
  };
  taxaSync: {
    success: boolean;
    error?: string;
    asaasPaymentId?: string;
    invoiceUrl?: string | null;
    bankSlipUrl?: string | null;
  } | null;
  subscriptionSync: {
    success: boolean;
    error?: string;
    asaasSubscriptionId?: string | null;
    asaasPaymentId?: string | null;
    invoiceUrl?: string | null;
    bankSlipUrl?: string | null;
    message?: string;
    expectedWebhooks?: string[];
  } | null;
}) {
  const { result, taxaSync, subscriptionSync } = input;
  return createMatriculaResultDTOSchema.parse({
    matricula: mapMatriculaRecordToCoreDTO(result.matricula),
    cobrancas: {
      taxa: result.cobrancas.taxa ? mapCobrancaRecordToDTO(result.cobrancas.taxa) : null,
      mensalidade: result.cobrancas.mensalidade
        ? mapCobrancaRecordToDTO(result.cobrancas.mensalidade)
        : null,
    },
    preco: result.preco,
    asaasSync: {
      taxa: taxaSync
        ? {
            success: taxaSync.success,
            error: taxaSync.error ?? null,
            asaasPaymentId: taxaSync.asaasPaymentId ?? null,
            invoiceUrl: taxaSync.invoiceUrl ?? null,
            bankSlipUrl: taxaSync.bankSlipUrl ?? null,
          }
        : null,
      subscription: subscriptionSync
        ? {
            success: subscriptionSync.success,
            error: subscriptionSync.error ?? null,
            asaasSubscriptionId: subscriptionSync.asaasSubscriptionId ?? null,
            asaasPaymentId: subscriptionSync.asaasPaymentId ?? null,
            invoiceUrl: subscriptionSync.invoiceUrl ?? null,
            bankSlipUrl: subscriptionSync.bankSlipUrl ?? null,
            message: subscriptionSync.message ?? null,
            expectedWebhooks: subscriptionSync.expectedWebhooks ?? [],
          }
        : null,
    },
    responsavelFinanceiro: result.responsavelFinanceiro
      ? {
          id: String(result.responsavelFinanceiro.id ?? ''),
          nome: String(result.responsavelFinanceiro.nome ?? ''),
          email: result.responsavelFinanceiro.email
            ? String(result.responsavelFinanceiro.email)
            : null,
          telefone: result.responsavelFinanceiro.telefone
            ? String(result.responsavelFinanceiro.telefone)
            : null,
        }
      : null,
    primeiroVencimento: result.primeiroVencimento.toISOString(),
  });
}

export function mapEditMatriculaResultToDTO(matricula: Record<string, unknown>) {
  return editMatriculaResultDTOSchema.parse({
    data: {
      id: String(matricula.id ?? ''),
      turmaId: matricula.turmaId ? String(matricula.turmaId) : null,
      comboId: matricula.comboId ? String(matricula.comboId) : null,
      planoId: matricula.planoId ? String(matricula.planoId) : null,
      asaasSubscriptionId: matricula.asaasSubscriptionId
        ? String(matricula.asaasSubscriptionId)
        : null,
    },
  });
}

export function mapMatriculaStatusSyncResultToDTO(
  result: Record<string, unknown>,
  message: string,
) {
  return matriculaStatusSyncResultDTOSchema.parse({
    success: true,
    message,
    data: {
      matriculaId: String(result.matriculaId ?? ''),
      status: result.newStatus,
      previousStatus: result.previousStatus,
      asaasAction: result.asaasAction,
      cobrancasAtualizadas: Number(result.cobrancasAtualizadas ?? 0),
      nextDueDate: toIsoString(result.nextDueDate as Nullable<Date | string>),
      paymentSync: result.paymentSync,
    },
  });
}

export function mapMatriculaDeleteResultToDTO(result: MatriculaDeleteResultDTO) {
  return matriculaDeleteResultDTOSchema.parse(result);
}

export function mapMatriculaReenviarCobrancaResultToDTO(result: {
  success: boolean;
  message: string;
  asaasPaymentId?: string | null;
  status?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCodeUrl?: string | null;
  pixCopyPaste?: string | null;
}): MatriculaReenviarCobrancaResultDTO {
  return matriculaReenviarCobrancaResultDTOSchema.parse({
    success: result.success,
    message: result.message,
    asaasPaymentId: result.asaasPaymentId ?? null,
    status: result.status ?? null,
    invoiceUrl: result.invoiceUrl ?? null,
    bankSlipUrl: result.bankSlipUrl ?? null,
    pixQrCodeUrl: result.pixQrCodeUrl ?? null,
    pixCopyPaste: result.pixCopyPaste ?? null,
  });
}

export function mapMatriculaGerarPixResultToDTO(result: {
  success: boolean;
  pixId: string;
  cobrancaId: string;
  matriculaId: string;
  qrCode: string;
  payload: string;
  valor: number;
  vencimento: Date;
}) {
  return matriculaGerarPixResultDTOSchema.parse({
    ...result,
    vencimento: result.vencimento.toISOString(),
  });
}

export function mapMatriculaSubscriptionValueUpdateResultToDTO(input: {
  subscriptionId: string;
  value: number;
  updatePendingPayments: boolean;
  message: string;
}) {
  return matriculaSubscriptionValueUpdateResultDTOSchema.parse({
    success: true,
    message: input.message,
    data: {
      subscriptionId: input.subscriptionId,
      value: input.value,
      updatePendingPayments: input.updatePendingPayments,
    },
  });
}

export function mapMatriculaSubscriptionBillingTypeUpdateResultToDTO(input: {
  billingType: MatriculaBillingTypeDTO;
  message: string;
}) {
  return matriculaSubscriptionBillingTypeUpdateResultDTOSchema.parse({
    success: true,
    message: input.message,
    data: {
      billingType: input.billingType,
    },
  });
}

export function mapMatriculaNotificationChannelsResultToDTO(input: {
  customerId: string;
  channels: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
  notificationCount: number;
  syncedAt: string;
  message?: string;
  warnings?: Array<{
    notificationId: string;
    event: string;
    channel: 'email' | 'sms' | 'whatsapp';
    code: string;
    message: string;
  }>;
}) {
  return matriculaNotificationChannelsResultDTOSchema.parse({
    ...input,
    warnings: input.warnings ?? [],
  });
}

export function mapMatriculaSubscriptionTermsUpdateResultToDTO(input: {
  interest?: { value: number; type?: MatriculaAdjustmentTypeDTO };
  fine?: { value: number; type?: MatriculaAdjustmentTypeDTO };
  discount?: { value: number; type?: MatriculaAdjustmentTypeDTO; dueDateLimitDays?: number };
  updated: {
    jurosMensal: number | null;
    jurosTipo: string | null;
    multaPercentual: number | null;
    multaTipo: string | null;
    descontoAntecipado: number | null;
    descontoTipo: string | null;
    prazoDesconto: number | null;
  };
  message: string;
}) {
  return matriculaSubscriptionTermsUpdateResultDTOSchema.parse({
    success: true,
    message: input.message,
    data: {
      interest: input.interest,
      fine: input.fine,
      discount: input.discount,
      updated: input.updated,
    },
  });
}
