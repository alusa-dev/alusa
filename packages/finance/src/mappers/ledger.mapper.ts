import type { AsaasFinancialTransactionType } from '@alusa/asaas';
import type { LedgerCategory, LedgerSign, LedgerEntryDTO } from '../dtos/ledger';
import type { LedgerEntryType, LedgerEntryStatus, LedgerEntry } from '../dtos/ledger';
import { parseExternalReference } from '../core/external-reference';

const CATEGORY_MAP: Record<string, LedgerCategory> = {
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PARTIAL_PAYMENT: 'PAYMENT_RECEIVED',
  CARD_SALE_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_FEE: 'PAYMENT_FEE',
  PAYMENT_FEE_REVERSAL: 'PAYMENT_FEE',
  CHARGED_FEE_REFUND: 'PAYMENT_FEE',
  REFUND_REQUEST_FEE: 'PAYMENT_FEE',
  REFUND_REQUEST_FEE_REVERSAL: 'PAYMENT_FEE',
  RECEIVABLE_ANTICIPATION_PAYMENT_FEE: 'PAYMENT_FEE',
  REVERSAL: 'PAYMENT_REFUND',
  PAYMENT_REVERSAL: 'PAYMENT_REFUND',
  PAYMENT_REFUND_CANCELLED: 'PAYMENT_REFUND',
  REFUND_REQUEST_CANCELLED: 'PAYMENT_REFUND',
  PIX_TRANSACTION_DEBIT_REFUND: 'PAYMENT_REFUND',
  PIX_TRANSACTION_CREDIT_REFUND: 'PAYMENT_REFUND',
  PIX_TRANSACTION_CREDIT_REFUND_CANCELLATION: 'PAYMENT_REFUND',
  PAYMENT_CUSTODY_BLOCK: 'CUSTODY',
  PAYMENT_CUSTODY_BLOCK_REVERSAL: 'CUSTODY',
  ACCOUNT_OWNER_PAYMENT_CUSTODY_CONFIG_FEE: 'CUSTODY',
  CUSTOMER_PAYMENT_CUSTODY_CONFIG_FEE: 'CUSTODY',
  TRANSFER: 'TRANSFER_SENT',
  TRANSFER_FEE: 'TRANSFER_FEE',
  TRANSFER_REVERSAL: 'TRANSFER_RECEIVED',
  INTERNAL_TRANSFER_DEBIT: 'INTERNAL_TRANSFER',
  INTERNAL_TRANSFER_CREDIT: 'INTERNAL_TRANSFER',
  INTERNAL_TRANSFER_REVERSAL: 'INTERNAL_TRANSFER',
  BILL_PAYMENT: 'BILL_PAYMENT',
  BILL_PAYMENT_FEE: 'BILL_PAYMENT',
  BILL_PAYMENT_CANCELLED: 'BILL_PAYMENT',
  BILL_PAYMENT_FEE_CANCELLED: 'BILL_PAYMENT',
  BILL_PAYMENT_REFUNDED: 'BILL_PAYMENT',
  PIX_TRANSACTION_DEBIT: 'PIX_DEBIT',
  PIX_TRANSACTION_CREDIT: 'PIX_CREDIT',
  PIX_TRANSACTION_DEBIT_FEE: 'PIX_FEE',
  PIX_TRANSACTION_CREDIT_FEE: 'PIX_FEE',
  PROMOTIONAL_CODE_CREDIT: 'PROMOTIONAL_CREDIT',
  PROMOTIONAL_CODE_DEBIT: 'PROMOTIONAL_CREDIT',
  FREE_PAYMENT_USE: 'PROMOTIONAL_CREDIT',
  FLAPP_STORE_PLAN_CHARGE_FEE_CREDIT: 'PROMOTIONAL_CREDIT',
  CHARGEBACK: 'CHARGEBACK',
  CHARGEBACK_REVERSAL: 'CHARGEBACK',
  RECEIVABLE_ANTICIPATION_GROSS_CREDIT: 'ANTICIPATION',
  RECEIVABLE_ANTICIPATION_DEBIT: 'ANTICIPATION',
  RECEIVABLE_ANTICIPATION_FEE: 'ANTICIPATION',
  RECEIVABLE_ANTICIPATION_PARTNER_SETTLEMENT: 'ANTICIPATION',
  RECEIVABLE_ANTICIPATION_CREDIT: 'ANTICIPATION',
  ASAAS_CARD_RECHARGE: 'CARD',
  ASAAS_CARD_RECHARGE_REVERSAL: 'CARD',
  ASAAS_CARD_BALANCE_REFUND: 'CARD',
  ASAAS_CARD_BILL_PAYMENT: 'CARD',
  ASAAS_CARD_BILL_PAYMENT_REFUND: 'CARD',
  ASAAS_CARD_SECURED_CREDIT_LIMIT_DEPOSIT: 'CARD',
  ASAAS_CARD_SECURED_CREDIT_LIMIT_WITHDRAWAL: 'CARD',
  ASAAS_CARD_TRANSACTION: 'CARD',
  ASAAS_CARD_CASHBACK: 'CARD',
  ASAAS_CARD_CREDIT_TRANSFER: 'CARD',
  ASAAS_CARD_CREDIT_TRANSFER_CANCELLATION: 'CARD',
  ASAAS_CARD_CREDIT_TRANSFER_PARTIAL_CANCELLATION: 'CARD',
  ASAAS_CARD_CREDIT_VOUCHER: 'CARD',
  ASAAS_CARD_CREDIT_VOUCHER_REFUND: 'CARD',
  ASAAS_CARD_DEBIT_TRANSFER: 'CARD',
  ASAAS_CARD_DEBIT_TRANSFER_CANCELLATION: 'CARD',
  ASAAS_CARD_DEBIT_TRANSFER_PARTIAL_CANCELLATION: 'CARD',
  ASAAS_CARD_TRANSACTION_FEE: 'CARD',
  ASAAS_CARD_TRANSACTION_WITHDRAWAL_FEE: 'CARD',
  ASAAS_CARD_TRANSACTION_IOF_FEE: 'CARD',
  ASAAS_CARD_TRANSACTION_REFUND: 'CARD',
  ASAAS_CARD_TRANSACTION_FEE_REFUND: 'CARD',
  ASAAS_CARD_TRANSACTION_WITHDRAWAL_FEE_REFUND: 'CARD',
  ASAAS_CARD_TRANSACTION_PARTIAL_REFUND: 'CARD',
  ASAAS_CARD_TRANSACTION_REFUND_CANCELLATION: 'CARD',
  ASAAS_CARD_TRANSACTION_PARTIAL_REFUND_CANCELLATION: 'CARD',
  CARD_SALE_ITEM_FEE: 'CARD',
  CARD_SALE_ITEM_FEE_REVERSAL: 'CARD',
  CARD_SALE_REVERSAL: 'CARD',
  INVOICE_FEE: 'INVOICE_FEE',
  PRODUCT_INVOICE_FEE: 'INVOICE_FEE',
  CONSUMER_INVOICE_FEE: 'INVOICE_FEE',
  PAYMENT_DUNNING_REQUEST_FEE: 'DUNNING_FEE',
  PAYMENT_DUNNING_RECEIVED_FEE: 'DUNNING_FEE',
  PAYMENT_DUNNING_RECEIVED_IN_CASH_FEE: 'DUNNING_FEE',
  PAYMENT_DUNNING_CANCELLATION_FEE: 'DUNNING_FEE',
  CREDIT_BUREAU_REPORT: 'DUNNING_FEE',
  CHILD_ACCOUNT_KNOWN_YOUR_CUSTOMER_BATCH_FEE: 'DUNNING_FEE',
  PAYMENT_MESSAGING_NOTIFICATION_FEE: 'NOTIFICATION_FEE',
  PAYMENT_SMS_NOTIFICATION_FEE: 'NOTIFICATION_FEE',
  CREDIT: 'OTHER',
  DEBIT: 'OTHER',
  DEBIT_REVERSAL: 'OTHER',
  PHONE_CALL_NOTIFICATION_FEE: 'NOTIFICATION_FEE',
  INSTANT_TEXT_MESSAGE_FEE: 'NOTIFICATION_FEE',
  POSTAL_SERVICE_FEE: 'NOTIFICATION_FEE',
  BACEN_JUDICIAL_LOCK: 'JUDICIAL',
  BACEN_JUDICIAL_UNLOCK: 'JUDICIAL',
  BACEN_JUDICIAL_TRANSFER: 'JUDICIAL',
  CUSTOMER_COMMISSION_SETTLEMENT_CREDIT: 'COMMISSION',
  CUSTOMER_COMMISSION_SETTLEMENT_DEBIT: 'COMMISSION',
  CUSTOMER_COMMISSION_CHECKOUT: 'COMMISSION',
  CONTRACTED_CUSTOMER_PLAN_FEE: 'PLAN_FEE',
  ACCOUNT_INACTIVITY_FEE: 'PLAN_FEE',
  FLAPP_STORE_PLAN_CHARGE_FEE: 'PLAN_FEE',
  MOBILE_PHONE_RECHARGE: 'MOBILE_RECHARGE',
  REFUND_MOBILE_PHONE_RECHARGE: 'MOBILE_RECHARGE',
  CANCEL_MOBILE_PHONE_RECHARGE: 'MOBILE_RECHARGE',
  ASAAS_MONEY_PAYMENT_ANTICIPATION_FEE: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_ANTICIPATION_FEE_REFUND: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_COMPROMISED_BALANCE_REFUND: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_DEBIT: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_DEBIT_REFUND: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_FINANCING_FEE: 'ASAAS_MONEY',
  ASAAS_MONEY_PAYMENT_FINANCING_FEE_REFUND: 'ASAAS_MONEY',
  ASAAS_MONEY_TRANSACTION_CASHBACK: 'ASAAS_MONEY',
  ASAAS_MONEY_TRANSACTION_CASHBACK_REFUND: 'ASAAS_MONEY',
  ASAAS_MONEY_TRANSACTION_CHARGEBACK: 'ASAAS_MONEY',
  ASAAS_MONEY_TRANSACTION_CHARGEBACK_REVERSAL: 'ASAAS_MONEY',
  CONTRACTUAL_EFFECT_SETTLEMENT: 'CONTRACTUAL_EFFECT',
  CONTRACTUAL_EFFECT_SETTLEMENT_REVERSAL: 'CONTRACTUAL_EFFECT',
  EXTERNAL_SETTLEMENT_CONTRACTUAL_EFFECT_BATCH_CREDIT: 'CONTRACTUAL_EFFECT',
  EXTERNAL_SETTLEMENT_CONTRACTUAL_EFFECT_BATCH_REVERSAL: 'CONTRACTUAL_EFFECT',
  ASAAS_DEBIT_CARD_REQUEST_FEE: 'OTHER',
  ASAAS_PREPAID_CARD_REQUEST_FEE: 'OTHER',
};

export function resolveCategory(asaasType: AsaasFinancialTransactionType | string): LedgerCategory {
  return CATEGORY_MAP[asaasType] ?? 'OTHER';
}

export function resolveSign(value: number): LedgerSign {
  return value >= 0 ? 'CREDIT' : 'DEBIT';
}

export interface AsaasTransactionRaw {
  id: string;
  value: number;
  balance: number;
  type: string;
  date: string;
  description: string;
  externalReference?: string | null;
  paymentId?: string | null;
  splitId?: string | null;
  transferId?: string | null;
  anticipationId?: string | null;
  billId?: string | null;
  invoiceId?: string | null;
  paymentDunningId?: string | null;
  creditBureauReportId?: string | null;
}

export function mapAsaasTransactionToLedgerEntry(raw: AsaasTransactionRaw): LedgerEntryDTO {
  return {
    id: raw.id,
    date: raw.date,
    description: raw.description,
    asaasType: raw.type,
    category: resolveCategory(raw.type),
    sign: resolveSign(raw.value),
    value: raw.value,
    balance: raw.balance,
    externalReference: raw.externalReference ?? null,
    paymentId: raw.paymentId ?? null,
    splitId: raw.splitId ?? null,
    transferId: raw.transferId ?? null,
    anticipationId: raw.anticipationId ?? null,
    billId: raw.billId ?? null,
    invoiceId: raw.invoiceId ?? null,
    paymentDunningId: raw.paymentDunningId ?? null,
    creditBureauReportId: raw.creditBureauReportId ?? null,
  };
}

// ─── LedgerEntryType resolution (26 categories → 6 types) ───

const CATEGORY_TO_TYPE: Record<LedgerCategory, LedgerEntryType> = {
  PAYMENT_RECEIVED: 'RECEITA',
  PIX_CREDIT: 'RECEITA',
  PAYMENT_FEE: 'TAXA',
  TRANSFER_FEE: 'TAXA',
  PIX_FEE: 'TAXA',
  INVOICE_FEE: 'TAXA',
  DUNNING_FEE: 'TAXA',
  NOTIFICATION_FEE: 'TAXA',
  PLAN_FEE: 'TAXA',
  PAYMENT_REFUND: 'ESTORNO',
  CHARGEBACK: 'ESTORNO',
  TRANSFER_SENT: 'TRANSFERENCIA',
  TRANSFER_RECEIVED: 'TRANSFERENCIA',
  INTERNAL_TRANSFER: 'TRANSFERENCIA',
  PIX_DEBIT: 'TRANSFERENCIA',
  BILL_PAYMENT: 'TRANSFERENCIA',
  ANTICIPATION: 'ANTECIPACAO',
  PROMOTIONAL_CREDIT: 'AJUSTE',
  CUSTODY: 'AJUSTE',
  CARD: 'AJUSTE',
  JUDICIAL: 'AJUSTE',
  COMMISSION: 'AJUSTE',
  MOBILE_RECHARGE: 'AJUSTE',
  ASAAS_MONEY: 'AJUSTE',
  CONTRACTUAL_EFFECT: 'AJUSTE',
  OTHER: 'AJUSTE',
};

export function resolveType(category: LedgerCategory): LedgerEntryType {
  return CATEGORY_TO_TYPE[category] ?? 'AJUSTE';
}

// ─── LedgerEntryStatus resolution ───

const FEE_CATEGORIES: ReadonlySet<LedgerCategory> = new Set([
  'PAYMENT_FEE',
  'TRANSFER_FEE',
  'PIX_FEE',
  'INVOICE_FEE',
  'DUNNING_FEE',
  'NOTIFICATION_FEE',
  'PLAN_FEE',
]);

export function resolveStatus(asaasType: string): LedgerEntryStatus {
  if (
    asaasType.includes('REVERSAL')
    || asaasType.includes('CANCELLED')
    || asaasType.includes('REFUND')
    || asaasType.includes('CANCELLATION')
  ) {
    return 'CANCELADO';
  }
  return 'CONFIRMADO';
}

// ─── Resolve fee from paired PAYMENT_FEE transactions ───

export function resolveFee(raw: AsaasTransactionRaw): number {
  const category = resolveCategory(raw.type);
  if (FEE_CATEGORIES.has(category)) {
    return Math.abs(raw.value);
  }
  return 0;
}

// ─── Canonical mapper: Asaas raw → LedgerEntry (new DTO) ───

export function mapToLedgerEntry(raw: AsaasTransactionRaw): LedgerEntry {
  const category = resolveCategory(raw.type);
  const type = resolveType(category);
  const status = resolveStatus(raw.type);
  const fee = resolveFee(raw);
  const grossValue = raw.value;
  const netValue = type === 'TAXA' ? 0 : raw.value;
  const parsedExternalReference = parseExternalReference(raw.externalReference);

  // Valores, status e saldo vêm do ledger oficial normalizado.
  // Nenhum desses campos deve ser recalculado a partir de cobranças ou entidades locais.
  return {
    id: raw.id,
    date: raw.date,
    description: raw.description,
    type,
    status,
    grossValue,
    fee,
    netValue,
    balanceAfter: raw.balance,
    externalReference: raw.externalReference ?? null,
    paymentId: raw.paymentId ?? null,
    splitId: raw.splitId ?? null,
    transferId: raw.transferId ?? null,
    invoiceId: raw.invoiceId ?? null,
    billId: raw.billId ?? null,
    paymentDunningId: raw.paymentDunningId ?? null,
    creditBureauReportId: raw.creditBureauReportId ?? null,
    source: 'ASAAS',
    metadata: {
      asaasType: raw.type,
      rawCategory: category,
      externalReference: raw.externalReference ?? undefined,
      externalReferenceType: parsedExternalReference?.type,
    },
  };
}
