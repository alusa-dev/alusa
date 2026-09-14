import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  paymentSimulationInputDTOSchema,
  simulatePaymentFees,
} from '@alusa/finance';
import { assertMobileBillingActor, MobileBillingUnauthorizedError } from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function simulationError(error: string) {
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') {
    return errorResponse('FINANCIAL_ACCOUNT_NOT_CONFIGURED', 'A conta financeira ainda não está pronta para simular cobranças.', 503);
  }
  if (error === 'RESULTADO_ASAAS_INVALIDO') {
    return errorResponse('SIMULATION_UNAVAILABLE', 'Não foi possível calcular uma estimativa agora.', 502);
  }
  return errorResponse('SIMULATION_UNAVAILABLE', 'Não foi possível calcular uma estimativa agora.', 502);
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  const verified = token ? await verifyMobileAccessToken(token) : null;
  if (!verified) return errorResponse('UNAUTHORIZED', 'Sessão inválida.', 401);

  const limiter = rateLimit(`mobile-billing:simulate:${verified.userId}:${ipFromRequest(request)}`, 20, 10 * 60 * 1000);
  if (!limiter.ok) return errorResponse('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429);

  try {
    await assertMobileBillingActor({ userId: verified.userId, contaId: verified.contaId });
    const input = paymentSimulationInputDTOSchema.parse(await request.json().catch(() => ({})));
    const result = await simulatePaymentFees({ contaId: verified.contaId, input });

    if (!result.success) return simulationError(result.error);
    return NextResponse.json({ data: result.data }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) {
      return errorResponse('FORBIDDEN', 'Você não tem permissão para simular cobranças.', 403);
    }
    if (error instanceof ZodError) {
      return errorResponse('INVALID_INPUT', 'Confira o valor e o número de parcelas informados.', 422, error.flatten());
    }
    console.error('[mobile-billing][simulate]', {
      contaId: verified.contaId,
      userId: verified.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('SERVER_ERROR', 'Não foi possível calcular a estimativa.', 500);
  }
}
