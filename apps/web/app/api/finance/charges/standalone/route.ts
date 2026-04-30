import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError, z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { createStandaloneCharge, listStandaloneCharges } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

const payerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('customer'), customerId: z.string().min(1) }),
  z.object({ type: z.literal('aluno'), alunoId: z.string().min(1) }),
  z.object({ type: z.literal('responsavel'), responsavelId: z.string().min(1) }),
]);

const discountSchema = z.object({
  value: z.number().positive(),
  type: z.enum(['FIXED', 'PERCENTAGE']),
  dueDateLimitDays: z.number().int().min(0).optional(),
}).optional();

const interestSchema = z.object({
  value: z.number().min(0),
}).optional();

const fineSchema = z.object({
  value: z.number().positive(),
  type: z.enum(['FIXED', 'PERCENTAGE']),
}).optional();

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Formato inválido. Use ex: "150.00"');

const allowedBillingTypesByChargeType = {
  ONE_TIME: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
  INSTALLMENT: ['BOLETO', 'CREDIT_CARD'],
  SUBSCRIPTION: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
} as const;

const postSchema = z.object({
  payer: payerSchema,
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT', 'SUBSCRIPTION']),
  billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),
  description: z.string().max(500).optional(),
  
  // ONE_TIME / SUBSCRIPTION
  value: z.coerce.number().positive().optional(),
  amount: moneyStringSchema.optional(), // compat legado (1 ciclo)
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  
  // INSTALLMENT
  installmentCount: z.coerce.number().int().min(2).max(24).optional(),
  installmentValue: z.coerce.number().positive().optional(),
  
  // SUBSCRIPTION
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cycle: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']).optional(),
  
  // Regras financeiras
  discount: discountSchema,
  interest: interestSchema,
  fine: fineSchema,
  
  // Idempotência
  uiRequestId: z.string().max(64).optional(),
  
  // Notificações
  notificationChannels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).optional(),
  notificationChannelsConfigured: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  const resolvedValue = data.value ?? (data.amount ? Number(data.amount) : undefined);
  const allowedBillingTypes = allowedBillingTypesByChargeType[data.chargeType] ?? [];

  if (!(allowedBillingTypes as readonly string[]).includes(data.billingType)) {
    ctx.addIssue({
      code: 'custom',
      message: `billingType inválido para ${data.chargeType}. Permitidos: ${allowedBillingTypes.join(', ')}`,
      path: ['billingType'],
    });
  }
  if (data.chargeType === 'ONE_TIME') {
    if (!resolvedValue || resolvedValue <= 0) {
      ctx.addIssue({ code: 'custom', message: 'value é obrigatório para ONE_TIME', path: ['value'] });
    }
    if (!data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'dueDate é obrigatório para ONE_TIME', path: ['dueDate'] });
    }
  }
  
  if (data.chargeType === 'INSTALLMENT') {
    if (!data.installmentCount) {
      ctx.addIssue({ code: 'custom', message: 'installmentCount é obrigatório para INSTALLMENT', path: ['installmentCount'] });
    }
    if (!data.installmentValue) {
      ctx.addIssue({ code: 'custom', message: 'installmentValue é obrigatório para INSTALLMENT', path: ['installmentValue'] });
    }
    if (!data.dueDate) {
      ctx.addIssue({ code: 'custom', message: 'dueDate é obrigatório para INSTALLMENT', path: ['dueDate'] });
    }
  }
  
  if (data.chargeType === 'SUBSCRIPTION') {
    if (!resolvedValue || resolvedValue <= 0) {
      ctx.addIssue({ code: 'custom', message: 'value é obrigatório para SUBSCRIPTION', path: ['value'] });
    }
    if (!data.nextDueDate) {
      ctx.addIssue({ code: 'custom', message: 'nextDueDate é obrigatório para SUBSCRIPTION', path: ['nextDueDate'] });
    }
    if (!data.cycle) {
      ctx.addIssue({ code: 'custom', message: 'cycle é obrigatório para SUBSCRIPTION', path: ['cycle'] });
    }
    if (!data.endDate) {
      ctx.addIssue({ code: 'custom', message: 'endDate é obrigatório para SUBSCRIPTION', path: ['endDate'] });
    }
  }
});

/**
 * GET /api/finance/charges/standalone
 * Lista cobranças avulsas (sem vínculo acadêmico).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Acesso negado' });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));
    const search = searchParams.get('q')?.trim() || undefined;
    const statusView = (searchParams.get('statusView') ?? 'open') as 'open' | 'paid' | 'all';

    const result = await listStandaloneCharges({
      contaId: user.contaId,
      page,
      pageSize,
      search,
      statusView,
    });

    return json(200, {
      data: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (e) {
    console.error('[Finance Charges Standalone][GET]', e);
    return json(500, { error: 'ERRO_INTERNO', message: (e as Error).message });
  }
}

/**
 * POST /api/finance/charges/standalone
 * 
 * Cria cobrança avulsa (customer-first), sem vínculo com matrícula.
 * Suporta: ONE_TIME (avulsa), INSTALLMENT (parcelada), SUBSCRIPTION (recorrente)
 * 
 * Idempotência: 
 * - Se uiRequestId for enviado, é usado como chave
 * - Caso contrário, calcula hash dos parâmetros
 * - Requisições duplicadas retornam a cobrança existente
 */
export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Acesso negado' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const payload = postSchema.parse(body);
    const headerIdempotencyKey = req.headers.get('x-idempotency-key')?.trim() || undefined;
    const normalizedValue = payload.value ?? (payload.amount ? Number(payload.amount) : undefined);

    if (payload.amount != null && payload.value == null) {
      console.warn('[finance][charges/standalone] payload legado "amount" utilizado; prefira "value"');
    }

    const result = await createStandaloneCharge({
      contaId: user.contaId,
      actor: { type: 'USER', id: user.id },
      payer: payload.payer,
      chargeType: payload.chargeType,
      billingType: payload.billingType,
      description: payload.description,
      value: normalizedValue,
      dueDate: payload.dueDate,
      installmentCount: payload.installmentCount,
      installmentValue: payload.installmentValue,
      nextDueDate: payload.nextDueDate,
      endDate: payload.endDate,
      cycle: payload.cycle,
      discount: payload.discount,
      interest: payload.interest,
      fine: payload.fine,
      uiRequestId: payload.uiRequestId ?? headerIdempotencyKey,
      notificationChannels: payload.notificationChannels,
      notificationChannelsConfigured: payload.notificationChannelsConfigured,
    });

    if (!result.success) {
      const errorMap: Record<string, { status: number; message: string }> = {
        FEATURE_DISABLED: { status: 403, message: 'Funcionalidade financeira desabilitada para esta conta' },
        KYC_NAO_APROVADO: { status: 409, message: 'Conta financeira não aprovada' },
        PAGADOR_NAO_ENCONTRADO: { status: 404, message: 'Pagador não encontrado' },
        PAGADOR_SEM_CPF: { status: 422, message: 'Pagador sem CPF cadastrado' },
        MATRICULA_NAO_ENCONTRADA: { status: 422, message: 'Nenhuma matrícula ativa encontrada para o pagador' },
        CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: { status: 503, message: 'Integração financeira não configurada' },
        CUSTOMER_SEM_ASAAS_ID: { status: 409, message: 'Cadastro financeiro do pagador incompleto' },
        FORMA_PAGAMENTO_INVALIDA: { status: 422, message: 'Forma de pagamento inválida' },
        VALOR_INVALIDO: { status: 422, message: 'Valor inválido' },
        DATA_INVALIDA: { status: 422, message: 'Data inválida' },
        PARCELAS_INVALIDAS: { status: 422, message: 'Número de parcelas inválido (mínimo 2)' },
        CICLO_OBRIGATORIO: { status: 422, message: 'Ciclo é obrigatório para assinatura' },
        SUBSCRIPTION_DUPLICADA: { status: 409, message: 'Já existe assinatura ativa para este contrato/pagador' },
        RESPONSAVEL_OBRIGATORIO_MENOR: { status: 422, message: 'Aluno menor exige responsável financeiro vinculado' },
        ERRO_AO_CRIAR_PAGAMENTO: { status: 502, message: 'Erro ao criar pagamento no provedor' },
        COBRANCA_DUPLICADA: { status: 409, message: 'Cobrança duplicada' },
      };

      const errInfo = errorMap[result.error] ?? { status: 500, message: 'Erro interno' };
      return json(errInfo.status, { error: result.error, message: errInfo.message });
    }

    return json(201, {
      success: true,
      data: {
        chargeId: result.data.chargeId,
        asaasPaymentId: result.data.asaasPaymentId,
        asaasSubscriptionId: result.data.asaasSubscriptionId,
        externalReference: result.data.externalReference,
        status: result.data.status,
        expectedWebhooks: result.data.expectedWebhooks ?? [],
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, {
        error: 'PAYLOAD_INVALIDO',
        message: 'Dados inválidos',
        details: error.flatten(),
      });
    }

    console.error('[Finance Charges Standalone][POST]', error);
    return json(500, {
      error: 'ERRO_INTERNO',
      message: error instanceof Error ? error.message : 'Erro interno',
    });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
