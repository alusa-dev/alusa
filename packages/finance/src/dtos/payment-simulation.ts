import { z } from 'zod';

export const paymentSimulationInputDTOSchema = z.object({
  value: z.number().finite().positive().max(1_000_000),
  installmentCount: z.number().int().min(1).max(21),
  passFeesToCustomer: z.boolean().default(false),
});

export type PaymentSimulationInputDTO = z.infer<typeof paymentSimulationInputDTOSchema>;

export type PaymentSimulationOutput = {
  requestedValue: number;
  simulatedValue: number;
  installmentCount: number;
  passFeesToCustomer: boolean;
  paymentValue: number;
  paymentNetValue: number;
  feeValue: number;
  feePercentage: number | null;
  operationFee: number | null;
};
