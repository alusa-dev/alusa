import type { InstallmentStatus } from '@prisma/client';

import type { CreateInstallmentPlanDTO } from '../dtos/installments/create-installment-plan.dto';
import type {
  CreateInstallmentPlanResultDTO,
  InstallmentStatusDTO,
} from '../dtos/installments/create-installment-plan-result.dto';
import type { ListInstallmentPlansQueryParsed } from '../dtos/installments/list-installment-plans-query.dto';
import type {
  InstallmentPlanListItemDTO,
  ListInstallmentPlansResultDTO,
} from '../dtos/installments/list-installment-plans-result.dto';
import type { CreateInstallmentPlanInput, CreateInstallmentPlanOutput } from '../use-cases/create-installment-plan';
import type { InstallmentPlanListItem, ListInstallmentPlansOutput } from '../use-cases/list-installment-plans';

function parseDecimalString(value: string): number {
  return parseFloat(value);
}

function toAmountString(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value;
}

export function mapCreateInstallmentPlanDTOToInput(
  dto: CreateInstallmentPlanDTO,
  context: { contaId: string; actorId: string }
): CreateInstallmentPlanInput {
  return {
    contaId: context.contaId,
    contratoId: dto.contratoId,
    matriculaId: dto.matriculaId,
    installmentCount: dto.installmentCount,
    billingType: dto.billingType,
    value: dto.value ?? parseDecimalString(dto.amount ?? '0'),
    firstDueDate: dto.firstDueDate,
    description: dto.description,
    discount: dto.discount,
    interest: dto.interest,
    fine: dto.fine,
    actor: { type: 'USER', id: context.actorId },
  };
}

export function mapCreateInstallmentPlanOutputToDTO(
  output: CreateInstallmentPlanOutput,
  dto: CreateInstallmentPlanDTO
): CreateInstallmentPlanResultDTO {
  return {
    id: output.installmentPlanId,
    externalReference: output.externalReference,
    asaasInstallmentId: output.asaasInstallmentId,
    status: output.status as InstallmentStatusDTO,
    installmentCount: dto.installmentCount,
    billingType: dto.billingType,
    amount: toAmountString(dto.value ?? dto.amount ?? 0),
    firstDueDate: dto.firstDueDate,
    createdAt: output.createdAt,
    statusUpdatedAt: output.statusUpdatedAt,
  };
}

export function mapInstallmentPlanToListItemDTO(item: InstallmentPlanListItem): InstallmentPlanListItemDTO {
  return {
    id: item.id,
    contratoId: item.contratoId,
    matriculaId: item.matriculaId,
    externalReference: item.externalReference,
    asaasInstallmentId: item.asaasInstallmentId,
    status: item.status as InstallmentStatusDTO,
    installmentCount: item.installmentCount,
    billingType: item.billingType,
    amount: item.amount,
    firstDueDate: item.firstDueDate,
    createdAt: item.createdAt,
    statusUpdatedAt: item.statusUpdatedAt,
  };
}

export function mapListInstallmentPlansOutputToDTO(
  output: ListInstallmentPlansOutput,
  query: ListInstallmentPlansQueryParsed
): ListInstallmentPlansResultDTO {
  return {
    items: output.items.map(mapInstallmentPlanToListItemDTO),
    total: output.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(output.total / query.pageSize),
  };
}

export function mapListInstallmentPlansQueryToInput(
  query: ListInstallmentPlansQueryParsed,
  contaId: string
): { contaId: string; limit: number; offset: number; status?: InstallmentStatus } {
  return {
    contaId,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
    status: query.status ? (query.status as InstallmentStatus) : undefined,
  };
}
