// Request Withdraw
export {
  requestWithdrawDTOSchema,
  type RequestWithdrawDTO,
  type PixDestinationDTO,
  type BankAccountDestinationDTO,
  type WithdrawDestinationDTO,
} from './request-withdraw.dto';

export {
  requestWithdrawResultDTOSchema,
  transferStatusSchema,
  type RequestWithdrawResultDTO,
  type TransferStatusDTO,
} from './request-withdraw-result.dto';

// List Transfers
export {
  listTransfersQueryDTOSchema,
  type ListTransfersQueryDTO,
  type ListTransfersQueryParsed,
} from './list-transfers-query.dto';

export {
  listTransfersResultDTOSchema,
  transferListItemDTOSchema,
  type ListTransfersResultDTO,
  type TransferListItemDTO,
} from './list-transfers-result.dto';
