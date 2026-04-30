import type { RequestWithdrawDTO, WithdrawDestinationDTO } from '../dtos/transfers/request-withdraw.dto';
import type { RequestWithdrawResultDTO, TransferStatusDTO } from '../dtos/transfers/request-withdraw-result.dto';
import type { TransferListItemDTO, ListTransfersResultDTO } from '../dtos/transfers/list-transfers-result.dto';
import type { TransferDetailResultDTO } from '../dtos/transfers/get-transfer-detail-result.dto';
import type { ListTransfersQueryParsed } from '../dtos/transfers/list-transfers-query.dto';
import type { RequestWithdrawInput, RequestWithdrawOutput, WithdrawDestination } from '../use-cases/request-withdraw';
import type { GetTransferDetailOutput } from '../use-cases/get-transfer-detail';
import type { TransferListItem, ListTransfersOutput } from '../use-cases/list-transfers';

/**
 * Formata número para string decimal com 2 casas
 * @example formatDecimal(150) -> "150.00"
 */
function formatDecimal(value: number): string {
  return value.toFixed(2);
}

/**
 * Converte string decimal para número
 * @example parseDecimalString("150.00") -> 150
 */
function parseDecimalString(value: string): number {
  return parseFloat(value);
}

/**
 * Mapeia DTO de destino para tipo interno do use case
 */
function mapDestinationDTOToInternal(dto: WithdrawDestinationDTO): WithdrawDestination {
  if (dto.type === 'PIX') {
    return {
      type: 'PIX',
      pixAddressKey: dto.pixAddressKey,
      pixAddressKeyType: dto.pixAddressKeyType,
      saveRecipient: dto.saveRecipient,
    };
  }

  return {
    type: 'BANK_ACCOUNT',
    bank: { code: dto.bank.code },
    accountName: dto.accountName,
    ownerName: dto.ownerName,
    ownerBirthDate: dto.ownerBirthDate,
    cpfCnpj: dto.cpfCnpj,
    agency: dto.agency,
    account: dto.account,
    accountDigit: dto.accountDigit,
    bankAccountType: dto.bankAccountType,
    ispb: dto.ispb,
  };
}

/**
 * Mapeia DTO de request withdraw para input do use case
 */
export function mapRequestWithdrawDTOToInput(
  dto: RequestWithdrawDTO,
  context: { contaId: string; idempotencyKey: string; actorId: string }
): RequestWithdrawInput {
  return {
    contaId: context.contaId,
    value: parseDecimalString(dto.amount),
    destination: mapDestinationDTOToInternal(dto.destination),
    description: dto.description,
    scheduleDate: dto.scheduleDate,
    idempotencyKey: context.idempotencyKey,
    actor: { type: 'USER', id: context.actorId },
  };
}

/**
 * Mapeia output do use case para DTO de resposta
 */
export function mapRequestWithdrawOutputToDTO(
  output: RequestWithdrawOutput,
  amount: string
): RequestWithdrawResultDTO {
  return {
    id: output.transferRequestId,
    externalReference: output.externalReference,
    status: output.status as TransferStatusDTO,
    amount,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Mapeia item interno para DTO de listagem
 */
export function mapTransferToListItemDTO(item: TransferListItem): TransferListItemDTO {
  return {
    id: item.id,
    externalReference: item.externalReference,
    amount: formatDecimal(item.value),
    feeAmount: item.feeValue === null ? null : formatDecimal(item.feeValue),
    netAmount: formatDecimal(item.netValue),
    status: item.status as TransferStatusDTO,
    operation: item.operation,
    recipientName: item.recipientName,
    cpfCnpj: item.cpfCnpjMasked,
    bankName: item.bankName,
    description: item.description,
    scheduleDate: item.scheduleDate,
    transferDate: item.transferDate,
    createdAt: item.createdAt,
    statusUpdatedAt: item.statusUpdatedAt,
  };
}

export function mapTransferDetailOutputToDTO(output: GetTransferDetailOutput): TransferDetailResultDTO {
  return {
    id: output.id,
    externalReference: output.externalReference,
    asaasTransferId: output.asaasTransferId,
    amount: formatDecimal(output.amount),
    feeAmount: output.feeAmount === null ? null : formatDecimal(output.feeAmount),
    netAmount: formatDecimal(output.netAmount),
    status: output.status as TransferStatusDTO,
    operation: output.operation,
    description: output.description,
    scheduleDate: output.scheduleDate,
    transferDate: output.transferDate,
    createdAt: output.createdAt,
    statusUpdatedAt: output.statusUpdatedAt,
    transactionReceiptUrl: output.transactionReceiptUrl,
    endToEndIdentifier: output.endToEndIdentifier,
    failReason: output.failReason,
    authorized: output.authorized,
    recipient: {
      name: output.recipient.name,
      cpfCnpj: output.recipient.cpfCnpj,
      bankName: output.recipient.bankName,
      pixKey: output.recipient.pixKey,
      agency: output.recipient.agency,
      account: output.recipient.account,
      accountDigit: output.recipient.accountDigit,
      accountType: output.recipient.accountType,
    },
  };
}

/**
 * Mapeia output do use case de listagem para DTO de resultado
 */
export function mapListTransfersOutputToDTO(
  output: ListTransfersOutput,
  query: ListTransfersQueryParsed
): ListTransfersResultDTO {
  return {
    items: output.items.map(mapTransferToListItemDTO),
    total: output.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(output.total / query.pageSize),
  };
}

/**
 * Converte query DTO parsed para input do use case
 */
export function mapListTransfersQueryToInput(
  query: ListTransfersQueryParsed,
  contaId: string
): {
  contaId: string;
  limit: number;
  offset: number;
  status?: string;
  search?: string;
  operation?: 'PIX' | 'TED';
  from?: string;
  to?: string;
  direction: 'asc' | 'desc';
} {
  return {
    contaId,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
    status: query.status,
    search: query.search,
    operation: query.operation,
    from: query.from,
    to: query.to,
    direction: query.direction,
  };
}
