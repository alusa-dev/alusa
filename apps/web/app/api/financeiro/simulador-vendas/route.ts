import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  paymentSimulationInputDTOSchema,
  simulatePaymentFees,
} from '@alusa/finance';
import { json, requireFinanceUser } from '../antecipacoes/_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function errorResponse(error: string) {
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') {
    return json(503, { error });
  }
  if (error === 'RESULTADO_ASAAS_INVALIDO') {
    return json(502, { error });
  }
  return json(502, { error: 'ERRO_ASAAS' });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const input = paymentSimulationInputDTOSchema.parse(await req.json());
    const result = await simulatePaymentFees({
      contaId: auth.user.contaId,
      input,
    });

    if (!result.success) return errorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }

    console.error('[API simulador-vendas][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
