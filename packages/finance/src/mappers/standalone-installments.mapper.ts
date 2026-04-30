import type { CreateStandaloneInstallmentDTO } from '../dtos/installments/create-standalone-installment.dto';
import type {
  CreateStandaloneInstallmentInput,
  CreateStandaloneInstallmentOutput,
} from '../use-cases/create-standalone-installment-plan';
import type { CreateInstallmentPlanResultDTO } from '../dtos/installments/create-installment-plan-result.dto';

function parseDecimalString(value: string): number {
  return parseFloat(value);
}

function toAmountString(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value;
}

export function mapCreateStandaloneInstallmentDTOToInput(
  dto: CreateStandaloneInstallmentDTO,
  context: { contaId: string; actorId: string }
): CreateStandaloneInstallmentInput {
  return {
    contaId: context.contaId,
    payer: dto.payer,
    installmentCount: dto.installmentCount,
    billingType: dto.billingType,
    value: dto.value ?? parseDecimalString(dto.amount ?? '0'),
    firstDueDate: dto.firstDueDate,
    description: dto.description,
    discount: dto.discount,
    interest: dto.interest,
    fine: dto.fine,
    uiRequestId: dto.uiRequestId,
    actor: { type: 'USER', id: context.actorId },
  };
}

export function mapCreateStandaloneInstallmentOutputToDTO(
  output: CreateStandaloneInstallmentOutput,
  dto: CreateStandaloneInstallmentDTO
): CreateInstallmentPlanResultDTO {
  return {
    id: output.installmentPlanId,
    externalReference: output.externalReference,
    asaasInstallmentId: output.asaasInstallmentId,
    status: output.status,
    installmentCount: dto.installmentCount,
    billingType: dto.billingType,
    amount: toAmountString(dto.value ?? dto.amount ?? 0),
    firstDueDate: dto.firstDueDate,
    createdAt: output.createdAt,
    statusUpdatedAt: output.statusUpdatedAt,
  };
}
