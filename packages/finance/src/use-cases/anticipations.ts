import {
  AsaasHttpError,
  cancelAnticipation as asaasCancelAnticipation,
  getAnticipationConfiguration as asaasGetAnticipationConfiguration,
  getAnticipationLimits as asaasGetAnticipationLimits,
  getMyAccountCommercialInfo as asaasGetMyAccountCommercialInfo,
  listAnticipations as asaasListAnticipations,
  listPayments as asaasListPayments,
  requestAnticipation as asaasRequestAnticipation,
  simulateAnticipation as asaasSimulateAnticipation,
  updateAnticipationConfiguration as asaasUpdateAnticipationConfiguration,
} from '@alusa/asaas';
import type {
  AsaasAnticipation,
  AsaasAnticipationConfiguration,
  AsaasAnticipationLimits,
  AsaasAnticipationSimulation,
  AsaasAnticipationStatus,
  AsaasMyAccountCommercialInfo,
  AsaasPayment,
  BillingType,
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { auditLogService } from '../foundation/audit-log.service';

export type AnticipationError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ALVO_INVALIDO'
  | 'ANTECIPACAO_AUTOMATICA_EXIGE_PJ'
  | 'ERRO_ASAAS';

export type AutomaticAnticipationEligibilityReason = 'PERSON_TYPE_MUST_BE_PJ';

export type ReceivableAnticipationConfiguration = AsaasAnticipationConfiguration & {
  automaticCreditCardEligible: boolean;
  automaticCreditCardReason: AutomaticAnticipationEligibilityReason | null;
  accountPersonType: string | null;
};

export type AnticipationTargetType = 'PAYMENT' | 'INSTALLMENT';

export type AnticipationTarget = {
  targetType: AnticipationTargetType;
  payment?: string;
  installment?: string;
};

export type AnticipationLocalContext = {
  source: 'ACADEMIC' | 'STANDALONE' | 'ACADEMIC_INSTALLMENT' | 'STANDALONE_INSTALLMENT' | 'ASAAS_ONLY';
  localId: string | null;
  description: string | null;
  payerName: string | null;
  billingType: string | null;
  dueDate: string | null;
  status: string | null;
  value: number | null;
};

export type AnticipationListItem = AsaasAnticipation & {
  context: AnticipationLocalContext;
};

export type ListAnticipationsInput = {
  contaId: string;
  page: number;
  pageSize: number;
  status?: AsaasAnticipationStatus;
  payment?: string;
  installment?: string;
};

export type ListAnticipationsOutput = {
  items: AnticipationListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  summary: {
    requestedValue: number;
    netValue: number;
    fees: number;
    credited: number;
    pending: number;
    denied: number;
  };
  fetchedAt: string;
};

export type AnticipationCandidate = {
  id: string;
  targetType: AnticipationTargetType;
  payment: string | null;
  installment: string | null;
  description: string | null;
  payerName: string | null;
  billingType: string;
  status: string;
  value: number;
  netValue: number | null;
  dueDate: string | null;
  estimatedCreditDate: string | null;
  invoiceUrl: string | null;
  source: AnticipationLocalContext['source'];
  localId: string | null;
};

export type ListAnticipationCandidatesInput = {
  contaId: string;
  page: number;
  pageSize: number;
  billingType?: 'ALL' | 'CREDIT_CARD' | 'BOLETO' | 'PIX';
  search?: string;
};

export type ListAnticipationCandidatesOutput = {
  items: AnticipationCandidate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  fetchedAt: string;
};

function normalizeTarget(target: AnticipationTarget): { payment?: string; installment?: string } | null {
  if (target.targetType === 'PAYMENT' && target.payment) return { payment: target.payment };
  if (target.targetType === 'INSTALLMENT' && target.installment) return { installment: target.installment };
  return null;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString().slice(0, 10);
}

function normalizePersonType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function buildAutomaticAnticipationEligibility(commercialInfo: AsaasMyAccountCommercialInfo): Pick<
  ReceivableAnticipationConfiguration,
  'automaticCreditCardEligible' | 'automaticCreditCardReason' | 'accountPersonType'
> {
  const personType = normalizePersonType(commercialInfo.personType);
  const isPhysicalPerson = personType === 'FISICA';

  return {
    automaticCreditCardEligible: !isPhysicalPerson,
    automaticCreditCardReason: isPhysicalPerson ? 'PERSON_TYPE_MUST_BE_PJ' : null,
    accountPersonType: personType,
  };
}

async function readAutomaticAnticipationEligibility(apiKey: string): Promise<Pick<
  ReceivableAnticipationConfiguration,
  'automaticCreditCardEligible' | 'automaticCreditCardReason' | 'accountPersonType'
>> {
  try {
    const commercialInfo = await asaasGetMyAccountCommercialInfo({ apiKey });
    return buildAutomaticAnticipationEligibility(commercialInfo);
  } catch {
    return {
      automaticCreditCardEligible: true,
      automaticCreditCardReason: null,
      accountPersonType: null,
    };
  }
}

function isAutomaticAnticipationRestrictedToLegalEntities(error: unknown): boolean {
  if (!(error instanceof AsaasHttpError)) return false;

  const response = error.responseBody ?? error.response;
  if (!response || typeof response !== 'object') return false;

  const errors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;

  return errors.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
    const description =
      typeof record.description === 'string' ? record.description.toLowerCase() : '';

    return code === 'invalid_action' && description.includes('apenas para contas do tipo pessoa jurídica');
  });
}

async function resolvePaymentContexts(contaId: string, paymentIds: string[]) {
  const unique = Array.from(new Set(paymentIds.filter(Boolean)));
  const contexts = new Map<string, AnticipationLocalContext>();
  if (!unique.length) return contexts;

  const [academicCharges, standaloneCharges] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        asaasPaymentId: { in: unique },
        matricula: { aluno: { contaId } },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        descricao: true,
        formaPagamento: true,
        status: true,
        vencimento: true,
        valor: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    }),
    prisma.charge.findMany({
      where: {
        contaId,
        asaasPaymentId: { in: unique },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        description: true,
        payerName: true,
        billingType: true,
        status: true,
        dueDate: true,
        value: true,
      },
    }),
  ]);

  for (const charge of standaloneCharges) {
    if (!charge.asaasPaymentId) continue;
    contexts.set(charge.asaasPaymentId, {
      source: 'STANDALONE',
      localId: charge.id,
      description: charge.description,
      payerName: charge.payerName,
      billingType: charge.billingType,
      dueDate: isoDate(charge.dueDate),
      status: charge.status,
      value: charge.value == null ? null : Number(charge.value),
    });
  }

  for (const charge of academicCharges) {
    if (!charge.asaasPaymentId) continue;
    contexts.set(charge.asaasPaymentId, {
      source: 'ACADEMIC',
      localId: charge.id,
      description: charge.descricao,
      payerName: charge.matricula.aluno.nome,
      billingType:
        charge.formaPagamento === 'CARTAO_CREDITO'
          ? 'CREDIT_CARD'
          : charge.formaPagamento === 'BOLETO'
            ? 'BOLETO'
            : charge.formaPagamento === 'PIX'
              ? 'PIX'
              : String(charge.formaPagamento),
      dueDate: isoDate(charge.vencimento),
      status: charge.status,
      value: Number(charge.valor),
    });
  }

  return contexts;
}

async function resolveInstallmentContexts(contaId: string, installmentIds: string[]) {
  const unique = Array.from(new Set(installmentIds.filter(Boolean)));
  const contexts = new Map<string, AnticipationLocalContext>();
  if (!unique.length) return contexts;

  const [academicPlans, standalonePlans] = await Promise.all([
    prisma.installmentPlan.findMany({
      where: { contaId, asaasInstallmentId: { in: unique } },
      select: {
        id: true,
        asaasInstallmentId: true,
        billingType: true,
        status: true,
        firstDueDate: true,
        value: true,
        installmentCount: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    }),
    prisma.standaloneInstallmentPlan.findMany({
      where: { contaId, asaasInstallmentId: { in: unique } },
      select: {
        id: true,
        asaasInstallmentId: true,
        billingType: true,
        status: true,
        firstDueDate: true,
        value: true,
        installmentCount: true,
        charges: {
          take: 1,
          orderBy: { dueDate: 'asc' },
          select: { payerName: true, description: true },
        },
      },
    }),
  ]);

  for (const plan of academicPlans) {
    if (!plan.asaasInstallmentId) continue;
    contexts.set(plan.asaasInstallmentId, {
      source: 'ACADEMIC_INSTALLMENT',
      localId: plan.id,
      description: `Parcelamento em ${plan.installmentCount}x`,
      payerName: plan.matricula.aluno.nome,
      billingType: plan.billingType,
      dueDate: isoDate(plan.firstDueDate),
      status: plan.status,
      value: Number(plan.value),
    });
  }

  for (const plan of standalonePlans) {
    if (!plan.asaasInstallmentId) continue;
    contexts.set(plan.asaasInstallmentId, {
      source: 'STANDALONE_INSTALLMENT',
      localId: plan.id,
      description: plan.charges[0]?.description ?? `Parcelamento em ${plan.installmentCount}x`,
      payerName: plan.charges[0]?.payerName ?? null,
      billingType: plan.billingType,
      dueDate: isoDate(plan.firstDueDate),
      status: plan.status,
      value: Number(plan.value),
    });
  }

  return contexts;
}

function fallbackContextFromAnticipation(item: AsaasAnticipation): AnticipationLocalContext {
  return {
    source: 'ASAAS_ONLY',
    localId: null,
    description: item.payment ? `Cobrança ${item.payment}` : item.installment ? `Parcelamento ${item.installment}` : null,
    payerName: null,
    billingType: null,
    dueDate: item.dueDate ?? null,
    status: item.status,
    value: item.totalValue,
  };
}

function fallbackContextFromPayment(payment: AsaasPayment): AnticipationLocalContext {
  return {
    source: 'ASAAS_ONLY',
    localId: null,
    description: payment.description ?? `Cobrança ${payment.id}`,
    payerName: null,
    billingType: payment.billingType,
    dueDate: payment.dueDate ?? null,
    status: payment.status,
    value: payment.value,
  };
}

function matchesSearch(candidate: AnticipationCandidate, search: string | undefined) {
  const term = search?.trim().toLocaleLowerCase('pt-BR');
  if (!term) return true;

  return [
    candidate.payment,
    candidate.installment,
    candidate.description,
    candidate.payerName,
    candidate.billingType,
    candidate.status,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('pt-BR')
    .includes(term);
}

export async function listReceivableAnticipations(
  input: ListAnticipationsInput,
): Promise<Result<ListAnticipationsOutput, AnticipationError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const offset = (input.page - 1) * input.pageSize;
    const response = await asaasListAnticipations({
      apiKey: credentials.apiKey,
      offset,
      limit: input.pageSize,
      status: input.status,
      payment: input.payment,
      installment: input.installment,
    });

    const paymentContexts = await resolvePaymentContexts(
      input.contaId,
      response.data.map((item) => item.payment).filter((value): value is string => Boolean(value)),
    );
    const installmentContexts = await resolveInstallmentContexts(
      input.contaId,
      response.data.map((item) => item.installment).filter((value): value is string => Boolean(value)),
    );

    const items = response.data.map((item) => ({
      ...item,
      context:
        (item.payment ? paymentContexts.get(item.payment) : undefined) ??
        (item.installment ? installmentContexts.get(item.installment) : undefined) ??
        fallbackContextFromAnticipation(item),
    }));

    const summary = items.reduce(
      (acc, item) => {
        acc.requestedValue += item.value;
        acc.netValue += item.netValue;
        acc.fees += item.fee;
        if (item.status === 'CREDITED') acc.credited += item.netValue;
        if (item.status === 'PENDING' || item.status === 'SCHEDULED') acc.pending += item.value;
        if (item.status === 'DENIED') acc.denied += item.value;
        return acc;
      },
      { requestedValue: 0, netValue: 0, fees: 0, credited: 0, pending: 0, denied: 0 },
    );

    return ok({
      items,
      total: response.totalCount,
      page: input.page,
      pageSize: input.pageSize,
      hasMore: response.hasMore,
      summary: {
        requestedValue: roundMoney(summary.requestedValue),
        netValue: roundMoney(summary.netValue),
        fees: roundMoney(summary.fees),
        credited: roundMoney(summary.credited),
        pending: roundMoney(summary.pending),
        denied: roundMoney(summary.denied),
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function listReceivableAnticipationCandidates(
  input: ListAnticipationCandidatesInput,
): Promise<Result<ListAnticipationCandidatesOutput, AnticipationError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const billingType =
      input.billingType && input.billingType !== 'ALL'
        ? (input.billingType as BillingType)
        : undefined;
    const offset = (input.page - 1) * input.pageSize;
    const response = await asaasListPayments({
      apiKey: credentials.apiKey,
      offset,
      limit: input.pageSize,
      anticipable: true,
      billingType,
    });

    const contexts = await resolvePaymentContexts(
      input.contaId,
      response.data.map((payment) => payment.id),
    );

    const items = response.data
      .map((payment): AnticipationCandidate => {
        const context = contexts.get(payment.id) ?? fallbackContextFromPayment(payment);
        return {
          id: `payment:${payment.id}`,
          targetType: 'PAYMENT',
          payment: payment.id,
          installment: payment.installment ?? null,
          description: context.description ?? payment.description ?? null,
          payerName: context.payerName,
          billingType: payment.billingType,
          status: payment.status,
          value: payment.value,
          netValue: typeof payment.netValue === 'number' ? payment.netValue : null,
          dueDate: payment.dueDate ?? context.dueDate,
          estimatedCreditDate: payment.estimatedCreditDate ?? null,
          invoiceUrl: payment.invoiceUrl ?? null,
          source: context.source,
          localId: context.localId,
        };
      })
      .filter((candidate) => matchesSearch(candidate, input.search));

    return ok({
      items,
      total: response.totalCount,
      page: input.page,
      pageSize: input.pageSize,
      hasMore: response.hasMore,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function simulateReceivableAnticipation(params: {
  contaId: string;
  target: AnticipationTarget;
}): Promise<Result<AsaasAnticipationSimulation, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  const target = normalizeTarget(params.target);
  if (!target) return err('ALVO_INVALIDO');

  try {
    return ok(await asaasSimulateAnticipation({ apiKey: credentials.apiKey, ...target }));
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function requestReceivableAnticipation(params: {
  contaId: string;
  userId: string;
  target: AnticipationTarget;
  document?: Blob;
  documentFilename?: string;
}): Promise<Result<AsaasAnticipation, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  const target = normalizeTarget(params.target);
  if (!target) return err('ALVO_INVALIDO');

  try {
    const anticipation = await asaasRequestAnticipation({
      apiKey: credentials.apiKey,
      ...target,
      document: params.document,
      documentFilename: params.documentFilename,
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.anticipation.requested',
      entity: { type: 'ReceivableAnticipation', id: anticipation.id },
      metadata: { target, anticipation },
      actor: { type: 'USER', id: params.userId },
    });

    return ok(anticipation);
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function cancelReceivableAnticipation(params: {
  contaId: string;
  userId: string;
  anticipationId: string;
}): Promise<Result<AsaasAnticipation, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const anticipation = await asaasCancelAnticipation({
      apiKey: credentials.apiKey,
      id: params.anticipationId,
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.anticipation.cancelled',
      entity: { type: 'ReceivableAnticipation', id: params.anticipationId },
      metadata: { anticipation },
      actor: { type: 'USER', id: params.userId },
    });

    return ok(anticipation);
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function getReceivableAnticipationLimits(params: {
  contaId: string;
}): Promise<Result<AsaasAnticipationLimits, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    return ok(await asaasGetAnticipationLimits({ apiKey: credentials.apiKey }));
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function getReceivableAnticipationConfiguration(params: {
  contaId: string;
}): Promise<Result<ReceivableAnticipationConfiguration, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const [configuration, eligibility] = await Promise.all([
      asaasGetAnticipationConfiguration({ apiKey: credentials.apiKey }),
      readAutomaticAnticipationEligibility(credentials.apiKey),
    ]);

    return ok({
      ...configuration,
      ...eligibility,
    });
  } catch {
    return err('ERRO_ASAAS');
  }
}

export async function updateReceivableAnticipationConfiguration(params: {
  contaId: string;
  userId: string;
  creditCardAutomaticEnabled: boolean;
}): Promise<Result<ReceivableAnticipationConfiguration, AnticipationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  const eligibility = await readAutomaticAnticipationEligibility(credentials.apiKey);

  if (
    params.creditCardAutomaticEnabled &&
    !eligibility.automaticCreditCardEligible &&
    eligibility.automaticCreditCardReason === 'PERSON_TYPE_MUST_BE_PJ'
  ) {
    return err('ANTECIPACAO_AUTOMATICA_EXIGE_PJ');
  }

  try {
    const configuration = await asaasUpdateAnticipationConfiguration({
      apiKey: credentials.apiKey,
      creditCardAutomaticEnabled: params.creditCardAutomaticEnabled,
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: params.creditCardAutomaticEnabled
        ? 'finance.anticipation.automatic_enabled'
        : 'finance.anticipation.automatic_disabled',
      entity: { type: 'ReceivableAnticipationConfiguration', id: params.contaId },
      metadata: { configuration },
      actor: { type: 'USER', id: params.userId },
    });

    return ok({
      ...configuration,
      ...eligibility,
    });
  } catch (error) {
    if (isAutomaticAnticipationRestrictedToLegalEntities(error)) {
      return err('ANTECIPACAO_AUTOMATICA_EXIGE_PJ');
    }

    return err('ERRO_ASAAS');
  }
}
