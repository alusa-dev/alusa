import { createStandaloneCharge } from '@alusa/finance';
import { z } from 'zod';

const customerPayerSchema = z.object({
  type: z.literal('customer'),
  customerId: z.string().min(1),
  payerType: z.enum(['ALUNO', 'RESPONSAVEL']).optional(),
  payerId: z.string().min(1).optional(),
});

const payerSchema = z.discriminatedUnion('type', [
  customerPayerSchema,
  z.object({ type: z.literal('aluno'), alunoId: z.string().min(1) }),
  z.object({ type: z.literal('responsavel'), responsavelId: z.string().min(1) }),
]).superRefine((payer, ctx) => {
  if (payer.type === 'customer' && ((payer.payerType == null) !== (payer.payerId == null))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payerType'],
      message: 'payerType e payerId devem ser informados juntos',
    });
  }
});

const discountSchema = z.object({
  value: z.number().positive(),
  type: z.enum(['FIXED', 'PERCENTAGE']),
  dueDateLimitDays: z.number().int().min(0).optional(),
}).optional();

const interestSchema = z.object({ value: z.number().min(0) }).optional();

const fineSchema = z.object({
  value: z.number().positive(),
  type: z.enum(['FIXED', 'PERCENTAGE']),
}).optional();

const moneyStringSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Formato inválido. Use ex: "150.00"');

const allowedBillingTypesByChargeType = {
  ONE_TIME: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
  INSTALLMENT: ['BOLETO', 'CREDIT_CARD'],
  SUBSCRIPTION: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
} as const;

export const standaloneChargePostSchema = z.object({
  payer: payerSchema,
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT', 'SUBSCRIPTION']),
  billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),
  description: z.string().max(500).optional(),
  value: z.coerce.number().positive().optional(),
  amount: moneyStringSchema.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  installmentCount: z.coerce.number().int().min(2).max(24).optional(),
  installmentValue: z.coerce.number().positive().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cycle: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']).optional(),
  discount: discountSchema,
  interest: interestSchema,
  fine: fineSchema,
  uiRequestId: z.string().max(64).optional(),
  notificationChannels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).optional(),
  notificationChannelsConfigured: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  const resolvedValue = data.value ?? (data.amount ? Number(data.amount) : undefined);
  const allowedBillingTypes = allowedBillingTypesByChargeType[data.chargeType] as readonly string[];

  if (!allowedBillingTypes.includes(data.billingType)) {
    ctx.addIssue({
      code: 'custom',
      message: `billingType inválido para ${data.chargeType}. Permitidos: ${allowedBillingTypes.join(', ')}`,
      path: ['billingType'],
    });
  }
  if (data.chargeType === 'ONE_TIME') {
    if (!resolvedValue || resolvedValue <= 0) ctx.addIssue({ code: 'custom', message: 'value é obrigatório para ONE_TIME', path: ['value'] });
    if (!data.dueDate) ctx.addIssue({ code: 'custom', message: 'dueDate é obrigatório para ONE_TIME', path: ['dueDate'] });
  }
  if (data.chargeType === 'INSTALLMENT') {
    if (!data.installmentCount) ctx.addIssue({ code: 'custom', message: 'installmentCount é obrigatório para INSTALLMENT', path: ['installmentCount'] });
    if (!data.installmentValue) ctx.addIssue({ code: 'custom', message: 'installmentValue é obrigatório para INSTALLMENT', path: ['installmentValue'] });
    if (!data.dueDate) ctx.addIssue({ code: 'custom', message: 'dueDate é obrigatório para INSTALLMENT', path: ['dueDate'] });
  }
  if (data.chargeType === 'SUBSCRIPTION') {
    if (!resolvedValue || resolvedValue <= 0) ctx.addIssue({ code: 'custom', message: 'value é obrigatório para SUBSCRIPTION', path: ['value'] });
    if (!data.nextDueDate) ctx.addIssue({ code: 'custom', message: 'nextDueDate é obrigatório para SUBSCRIPTION', path: ['nextDueDate'] });
    if (!data.cycle) ctx.addIssue({ code: 'custom', message: 'cycle é obrigatório para SUBSCRIPTION', path: ['cycle'] });
    if (!data.endDate) ctx.addIssue({ code: 'custom', message: 'endDate é obrigatório para SUBSCRIPTION', path: ['endDate'] });
  }
});

export type StandaloneChargePostPayload = z.infer<typeof standaloneChargePostSchema>;

export function parseStandaloneChargeListQuery(searchParams: URLSearchParams) {
  const parsePositiveInt = (value: string | null, fallback: number, max: number) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
  };

  const requestedStatusView = searchParams.get('statusView');
  const statusView: 'open' | 'paid' | 'all' = requestedStatusView === 'paid' || requestedStatusView === 'all' || requestedStatusView === 'open'
    ? requestedStatusView
    : 'open';
  return {
    page: parsePositiveInt(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER),
    pageSize: parsePositiveInt(searchParams.get('pageSize'), 20, 100),
    search: searchParams.get('q')?.trim() || undefined,
    statusView,
  };
}

export function parseStandaloneChargePayload(body: unknown) {
  const payload = standaloneChargePostSchema.parse(body);
  const value = payload.value ?? (payload.amount ? Number(payload.amount) : undefined);
  return { payload, value };
}

export function buildStandaloneChargeInput(params: {
  payload: StandaloneChargePostPayload;
  value?: number;
  contaId: string;
  userId: string;
  idempotencyKey?: string;
}) {
  const { payload } = params;
  return {
    contaId: params.contaId,
    actor: { type: 'USER' as const, id: params.userId },
    payer: payload.payer,
    chargeType: payload.chargeType,
    billingType: payload.billingType,
    description: payload.description,
    value: params.value,
    dueDate: payload.dueDate,
    installmentCount: payload.installmentCount,
    installmentValue: payload.installmentValue,
    nextDueDate: payload.nextDueDate,
    endDate: payload.endDate,
    cycle: payload.cycle,
    discount: payload.discount,
    interest: payload.interest,
    fine: payload.fine,
    uiRequestId: payload.uiRequestId ?? params.idempotencyKey,
    notificationChannels: payload.notificationChannels,
    notificationChannelsConfigured: payload.notificationChannelsConfigured,
  };
}

export function mapStandaloneChargeCreationResult(result: Awaited<ReturnType<typeof createStandaloneCharge>>) {
  if (!result.success) {
    const errorMap: Record<string, { status: number; message: string }> = {
      FEATURE_DISABLED: { status: 403, message: 'Funcionalidade financeira desabilitada para esta conta' },
      KYC_NAO_APROVADO: { status: 409, message: 'Conta financeira não aprovada' },
      PAGADOR_NAO_ENCONTRADO: { status: 404, message: 'Pagador não encontrado' },
      PAGADOR_AMBIGUO: { status: 422, message: 'Informe o papel do pagador para esta identidade financeira compartilhada' },
      PAGADOR_DIVERGENTE: { status: 409, message: 'A chave de idempotência já está vinculada a outro pagador' },
      PAGADOR_SEM_CPF: { status: 422, message: 'Pagador sem CPF cadastrado' },
      MATRICULA_NAO_ENCONTRADA: { status: 422, message: 'Nenhuma matrícula ativa encontrada para o pagador' },
      CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: { status: 503, message: 'Integração financeira não configurada' },
      CUSTOMER_SEM_ASAAS_ID: { status: 409, message: 'Cadastro financeiro do pagador incompleto' },
      FORMA_PAGAMENTO_INVALIDA: { status: 422, message: 'Forma de pagamento inválida' },
      VALOR_INVALIDO: { status: 422, message: 'Valor inválido' },
      DATA_INVALIDA: { status: 422, message: 'Data inválida' },
      PARCELAS_INVALIDAS: { status: 422, message: 'Número de parcelas inválido (mínimo 2)' },
      CICLO_OBRIGATORIO: { status: 422, message: 'Ciclo é obrigatório para assinatura' },
      NOTIFICACOES_NAO_CONFIGURADAS: { status: 502, message: 'Não foi possível configurar as notificações. A cobrança não foi criada.' },
      SUBSCRIPTION_DUPLICADA: { status: 409, message: 'Já existe assinatura ativa para este contrato/pagador' },
      RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
      ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
      COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
    };
    const errInfo = errorMap[result.error] ?? { status: 500, message: 'Erro interno' };
    return { status: errInfo.status, body: { error: result.error, message: errInfo.message } };
  }

  const pendingReconciliation = result.data.status === 'PENDING_RECONCILIATION';
  return {
    status: pendingReconciliation ? 202 : 201,
    body: {
      success: true,
      ...(pendingReconciliation
        ? { pending: true, message: 'Solicitação recebida. A confirmação financeira será concluída automaticamente.' }
        : {}),
      data: {
        chargeId: result.data.chargeId,
        asaasPaymentId: result.data.asaasPaymentId,
        asaasSubscriptionId: result.data.asaasSubscriptionId,
        externalReference: result.data.externalReference,
        status: result.data.status,
        expectedWebhooks: result.data.expectedWebhooks ?? [],
        notificationSync: result.data.notificationSync ?? null,
      },
    },
  };
}
