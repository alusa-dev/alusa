import { requestStoreSaleRefund, type StoreSaleRefundDispatch } from '@alusa/finance';

import { executeCobrancaRefund } from '@/src/server/finance/refund-charge.service';

type Input = {
  contaId: string;
  saleId: string;
  returnId: string;
  actorId: string;
  role: string;
  mode: 'REQUEST' | 'RETRY_DENIED';
};

const dispatchRefund: StoreSaleRefundDispatch = async (input) => executeCobrancaRefund({
  contaId: input.contaId,
  userId: input.actorId,
  role: input.role,
  id: input.chargeId,
  correlationId: input.correlationId,
  storeSaleReturnId: input.returnId,
  storeSaleRefundAttemptId: input.attemptId,
  body: {
    ...(input.value === undefined ? {} : { value: input.value }),
    description: input.description,
  },
});

export async function requestStoreSaleRefundFromApp(input: Input) {
  return requestStoreSaleRefund({ ...input, dispatch: dispatchRefund });
}
