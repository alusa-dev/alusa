import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  executeMobileBillingAction,
  MobileBillingUnauthorizedError,
  type MobileBillingChargeChanges,
} from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['CONFIRM_CASH_PAYMENT', 'CANCEL', 'REFUND', 'UNDO_CASH_PAYMENT', 'UPDATE_CHARGE', 'UPDATE_RULES']),
  changes: z.object({
    amount: z.number().positive().finite().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().trim().max(200).optional(),
    paymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO', 'INDEFINIDO']).optional(),
    interestPercent: z.number().min(0).max(100).finite().optional(),
    finePercent: z.number().min(0).max(100).finite().optional(),
    discountValue: z.number().min(0).finite().optional(),
    discountType: z.enum(['FIXED', 'PERCENTAGE']).optional(),
    discountDueDateLimitDays: z.number().int().min(0).max(30).optional(),
  }).optional(),
});

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function responseError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function statusForActionError(code: string) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'NO_PROVIDER_PAYMENT' || code === 'ACTION_NOT_SUPPORTED') return 409;
  if (code === 'STATUS_NOT_EDITABLE' || code === 'ASAAS_STATUS_NOT_EDITABLE') return 409;
  return 400;
}

export async function POST(request: Request, context: { params: Promise<{ chargeId: string }> }) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return responseError('UNAUTHORIZED', 'Sessão inválida.', 401);

  const { chargeId } = await context.params;
  const limiter = rateLimit(
    `mobile-billing:charge-action:${actor.userId}:${chargeId}:${ipFromRequest(request)}`,
    20,
    10 * 60 * 1000,
  );
  if (!limiter.ok) return responseError('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return responseError('INVALID_INPUT', 'Ação de cobrança inválida.', 422);

  try {
    const result = await executeMobileBillingAction({
      actor: { userId: actor.userId, contaId: actor.contaId },
      chargeId,
      action: parsed.data.action,
      changes: parsed.data.changes as MobileBillingChargeChanges | undefined,
    });

    if (!result.success) return responseError(result.code, result.error, statusForActionError(result.code));
    return NextResponse.json(
      { success: true, message: result.message },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return responseError('UNAUTHORIZED', 'Acesso negado.', 401);
    return responseError('SERVER_ERROR', 'Não foi possível concluir a ação da cobrança.', 500);
  }
}
