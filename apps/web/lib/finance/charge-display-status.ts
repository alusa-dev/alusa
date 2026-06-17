import {
  resolveChargeDisplayStatus,
  unifiedChargeStatusToLocal,
  type ResolveChargeDisplayStatusInput,
} from '@alusa/finance/client';
import { z } from 'zod';

export const chargeDisplayStatusDTOSchema = z.object({
  status: z.string(),
  label: z.string(),
  hint: z.string().nullable(),
  variant: z.enum(['success', 'warning', 'danger', 'info', 'neutral']),
  source: z.enum(['asaas', 'liquidacao', 'local']).optional(),
});

export type ChargeDisplayStatusDTO = z.infer<typeof chargeDisplayStatusDTOSchema>;

export function buildChargeDisplayStatusDTO(
  input: ResolveChargeDisplayStatusInput,
): ChargeDisplayStatusDTO {
  const localStatus = input.localStatus
    ? unifiedChargeStatusToLocal(String(input.localStatus))
    : input.localStatus;
  const displayStatus = resolveChargeDisplayStatus({ ...input, localStatus });
  return chargeDisplayStatusDTOSchema.parse(displayStatus);
}

export function isPaidDisplayStatus(displayStatus: Pick<ChargeDisplayStatusDTO, 'status'> | null | undefined) {
  const status = displayStatus?.status ?? '';
  return ['PAGO', 'PAID', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(status);
}

export function isPendingDisplayStatus(displayStatus: Pick<ChargeDisplayStatusDTO, 'status'> | null | undefined) {
  const status = displayStatus?.status ?? '';
  return ['PENDENTE', 'PENDING', 'OPEN', 'A_VENCER', 'ATRASADO', 'OVERDUE', 'PROCESSANDO', 'AWAITING_RISK_ANALYSIS'].includes(
    status,
  );
}
