import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import {
  assertMobileBillingActor,
  createMobileStandaloneCharge,
  MobileBillingUnauthorizedError,
  type MobileBillingActor,
} from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const payerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('aluno'), alunoId: z.string().min(1) }),
  z.object({ type: z.literal('responsavel'), responsavelId: z.string().min(1) }),
]);

const postSchema = z.object({
  payer: payerSchema,
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT', 'SUBSCRIPTION']),
  billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),
  description: z.string().trim().max(500).optional(),
  value: z.number().positive().finite().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  installmentCount: z.number().int().min(2).max(24).optional(),
  installmentValue: z.number().positive().finite().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cycle: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']).optional(),
  discount: z.object({
    value: z.number().positive().finite(),
    type: z.enum(['FIXED', 'PERCENTAGE']),
    dueDateLimitDays: z.number().int().min(0).max(30).optional(),
  }).optional(),
  interest: z.object({ value: z.number().min(0).max(100).finite() }).optional(),
  fine: z.object({
    value: z.number().positive().finite(),
    type: z.enum(['FIXED', 'PERCENTAGE']),
  }).optional(),
  uiRequestId: z.string().trim().min(1).max(64).optional(),
}).superRefine((data, ctx) => {
  const allowedBillingTypes = {
    ONE_TIME: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
    INSTALLMENT: ['BOLETO', 'CREDIT_CARD'],
    SUBSCRIPTION: ['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED'],
  } as const;

  if (!allowedBillingTypes[data.chargeType].includes(data.billingType as never)) {
    ctx.addIssue({ code: 'custom', path: ['billingType'], message: 'Forma de pagamento inválida para este tipo de cobrança.' });
  }
  if (data.chargeType === 'ONE_TIME') {
    if (!data.value || !data.dueDate) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Valor e vencimento são obrigatórios.' });
  }
  if (data.chargeType === 'INSTALLMENT') {
    if (!data.installmentCount || !data.installmentValue || !data.dueDate) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'Parcelas, valor e vencimento são obrigatórios.' });
  }
  if (data.chargeType === 'SUBSCRIPTION') {
    if (!data.value || !data.nextDueDate || !data.cycle || !data.endDate) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Valor, ciclo, vencimento e fim da assinatura são obrigatórios.' });
  }
});

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function responseError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function errorStatus(code: string) {
  if (code === 'FEATURE_DISABLED') return 403;
  if (code === 'KYC_NAO_APROVADO' || code === 'PAGADOR_DIVERGENTE' || code === 'SUBSCRIPTION_DUPLICADA') return 409;
  if (code === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' || code === 'ERRO_AO_CRIAR_PAGAMENTO') return 503;
  if (code === 'PAGADOR_NAO_ENCONTRADO') return 404;
  return 422;
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    PAGADOR_NAO_ENCONTRADO: 'Pagador não encontrado.',
    PAGADOR_SEM_CPF: 'Pagador sem CPF cadastrado.',
    CUSTOMER_SEM_ASAAS_ID: 'Cadastro financeiro do pagador incompleto.',
    CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: 'Integração financeira não configurada.',
    FORMA_PAGAMENTO_INVALIDA: 'Forma de pagamento inválida.',
    VALOR_INVALIDO: 'Valor inválido.',
    DATA_INVALIDA: 'A data informada precisa ser hoje ou uma data futura.',
    PARCELAS_INVALIDAS: 'Número de parcelas inválido.',
    CICLO_OBRIGATORIO: 'Ciclo é obrigatório para assinatura.',
    KYC_NAO_APROVADO: 'A conta financeira ainda não está aprovada.',
    ERRO_AO_CRIAR_PAGAMENTO: 'Não foi possível criar o pagamento no provedor.',
    COBRANCA_DUPLICADA: 'Esta cobrança já foi criada.',
  };
  return messages[code] ?? 'Não foi possível criar a cobrança.';
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  const verified = token ? await verifyMobileAccessToken(token) : null;
  if (!verified) return responseError('UNAUTHORIZED', 'Sessão inválida.', 401);

  const actor: MobileBillingActor = { userId: verified.userId, contaId: verified.contaId };
  const limiter = rateLimit(`mobile-billing:create:${actor.userId}:${ipFromRequest(request)}`, 10, 10 * 60 * 1000);
  if (!limiter.ok) return responseError('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429);

  try {
    await assertMobileBillingActor(actor);

    try {
      await assertPlatformAccessForConta({ contaId: actor.contaId, capability: 'CHARGE_CREATE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return responseError(String(blocked.body.error), blocked.body.message, blocked.status, blocked.body.details);
      throw error;
    }

    const gate = await guardFinancialAccountOr412(actor.contaId);
    if (!gate.ok) return gate.response;

    const parsed = postSchema.parse(await request.json().catch(() => ({})));
    const result = await createMobileStandaloneCharge({ actor, charge: parsed });

    if (!result.success) {
      return responseError(result.error, errorMessage(result.error), errorStatus(result.error));
    }

    const pending = result.data.status === 'PENDING_RECONCILIATION';
    return NextResponse.json(
      {
        success: true,
        ...(pending ? { pending: true, message: 'Solicitação recebida. A confirmação financeira será concluída automaticamente.' } : {}),
        data: {
          chargeId: result.data.chargeId,
          asaasPaymentId: result.data.asaasPaymentId,
          asaasSubscriptionId: result.data.asaasSubscriptionId,
          externalReference: result.data.externalReference,
          status: result.data.status,
          expectedWebhooks: result.data.expectedWebhooks ?? [],
        },
      },
      { status: pending ? 202 : 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return responseError('FORBIDDEN', 'Você não tem permissão para criar cobranças.', 403);
    if (error instanceof ZodError) return responseError('INVALID_INPUT', 'Confira os dados informados.', 422, error.flatten());
    console.error('[mobile-billing][create]', { contaId: actor.contaId, userId: actor.userId, error: error instanceof Error ? error.message : String(error) });
    return responseError('SERVER_ERROR', 'Não foi possível criar a cobrança.', 500);
  }
}
