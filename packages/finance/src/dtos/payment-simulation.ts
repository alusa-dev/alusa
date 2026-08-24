import { z } from 'zod';

export const paymentSimulationInputDTOSchema = z.object({
  value: z.number().finite().positive().max(1_000_000),
  installmentCount: z.number().int().min(1).max(21),
});

export type PaymentSimulationInputDTO = z.infer<typeof paymentSimulationInputDTOSchema>;

export type PaymentSimulationOutput = {
  requestedValue: number;
  /** Valor total retornado pelo simulador oficial do Asaas. */
  chargeValue: number;
  installmentCount: number;
  /** Líquido total da cobrança, retornado em creditCard.netValue. */
  netValue: number;
  /** Valor da parcela retornado pelo simulador oficial do Asaas. */
  installmentValue: number;
  /** Líquido da parcela retornado pelo simulador oficial do Asaas. */
  installmentNetValue: number;
  feeValue: number;
  feePercentage: number | null;
  operationFee: number | null;
};
