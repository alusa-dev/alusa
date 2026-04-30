import type { CreateSubscriptionDTO } from '../dtos/subscriptions/create-subscription.dto';
import type { CreateSubscriptionResultDTO, SubscriptionStatusDTO } from '../dtos/subscriptions/create-subscription-result.dto';
import type { ListSubscriptionsQueryParsed } from '../dtos/subscriptions/list-subscriptions-query.dto';
import type { ListSubscriptionsResultDTO, SubscriptionListItemDTO } from '../dtos/subscriptions/list-subscriptions-result.dto';
import type { CreateSubscriptionInput, CreateSubscriptionOutput } from '../use-cases/create-subscription';
import type { SubscriptionListItem, ListSubscriptionsOutput } from '../use-cases/list-subscriptions';
import type { SubscriptionStatus } from '@prisma/client';

function parseDecimalString(value: string): number {
  return parseFloat(value);
}

function toAmountString(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value;
}

export function mapCreateSubscriptionDTOToInput(
  dto: CreateSubscriptionDTO,
  context: { contaId: string; actorId: string; idempotencyKey?: string }
): CreateSubscriptionInput {
  return {
    contaId: context.contaId,
    contratoId: dto.contratoId,
    matriculaId: dto.matriculaId,
    idempotencyKey: context.idempotencyKey,
    value: dto.value ?? parseDecimalString(dto.amount ?? '0'),
    nextDueDate: dto.nextDueDate,
    billingType: dto.billingType,
    cycle: dto.cycle,
    description: dto.description,
    endDate: dto.endDate,
    discount: dto.discount,
    interest: dto.interest,
    fine: dto.fine,
    actor: { type: 'USER', id: context.actorId },
  };
}

export function mapCreateSubscriptionOutputToDTO(
  output: CreateSubscriptionOutput,
  amount: string | number
): CreateSubscriptionResultDTO {
  return {
    id: output.subscriptionId,
    externalReference: output.externalReference,
    asaasSubscriptionId: output.asaasSubscriptionId,
    status: output.status as SubscriptionStatusDTO,
    amount: toAmountString(amount),
    createdAt: output.createdAt,
    statusUpdatedAt: output.statusUpdatedAt,
  };
}

export function mapSubscriptionToListItemDTO(item: SubscriptionListItem): SubscriptionListItemDTO {
  return {
    id: item.id,
    contratoId: item.contratoId,
    matriculaId: item.matriculaId,
    externalReference: item.externalReference,
    asaasSubscriptionId: item.asaasSubscriptionId,
    status: item.status as SubscriptionStatusDTO,
    createdAt: item.createdAt,
    statusUpdatedAt: item.statusUpdatedAt,
  };
}

export function mapListSubscriptionsOutputToDTO(
  output: ListSubscriptionsOutput,
  query: ListSubscriptionsQueryParsed
): ListSubscriptionsResultDTO {
  return {
    items: output.items.map(mapSubscriptionToListItemDTO),
    total: output.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(output.total / query.pageSize),
  };
}

export function mapListSubscriptionsQueryToInput(
  query: ListSubscriptionsQueryParsed,
  contaId: string
): { contaId: string; limit: number; offset: number; status?: SubscriptionStatus } {
  return {
    contaId,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
    status: query.status ? (query.status as SubscriptionStatus) : undefined,
  };
}
