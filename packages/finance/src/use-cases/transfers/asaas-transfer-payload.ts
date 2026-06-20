import type { CreateBankTransferInput, CreatePixTransferInput } from '@alusa/asaas';

import type { GetTransferFeesOutput } from '../get-transfer-fees';
import type { WithdrawDestination } from '../request-withdraw';

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';

export function normalizeDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

export function normalizePixPhoneForAsaas(value: string): string {
  let digits = normalizeDigits(value);
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits;
}

export function isValidPixPhoneKey(value: string): boolean {
  return normalizePixPhoneForAsaas(value).length === 11;
}

export function normalizePixKeyForAsaas(value: string, type: PixKeyType): string {
  const trimmed = value.trim();

  switch (type) {
    case 'CPF':
    case 'CNPJ':
      return normalizeDigits(trimmed);
    case 'PHONE':
      return normalizePixPhoneForAsaas(trimmed);
    case 'EMAIL':
      return trimmed.toLowerCase();
    case 'EVP':
      return trimmed.toLowerCase();
    default:
      return trimmed.toLowerCase();
  }
}

export function normalizeCpfCnpjForAsaas(value: string): string {
  return normalizeDigits(value);
}

export function normalizeWithdrawDestinationForAsaas(destination: WithdrawDestination): WithdrawDestination {
  if (destination.type === 'PIX') {
    return {
      ...destination,
      pixAddressKey: normalizePixKeyForAsaas(destination.pixAddressKey, destination.pixAddressKeyType),
    };
  }

  return {
    ...destination,
    bank: { code: normalizeDigits(destination.bank.code) },
    accountName: destination.accountName?.trim() || undefined,
    ownerName: destination.ownerName.trim().replace(/\s+/g, ' '),
    ownerBirthDate: destination.ownerBirthDate?.trim() || undefined,
    cpfCnpj: normalizeCpfCnpjForAsaas(destination.cpfCnpj),
    agency: normalizeDigits(destination.agency),
    account: normalizeDigits(destination.account),
    accountDigit: normalizeDigits(destination.accountDigit),
    ispb: destination.ispb ? normalizeDigits(destination.ispb) : undefined,
  };
}

export function requiresOwnerBirthDate(
  tenantCpfCnpj: string | null | undefined,
  beneficiaryCpfCnpj: string,
): boolean {
  const beneficiaryDigits = normalizeCpfCnpjForAsaas(beneficiaryCpfCnpj);
  if (beneficiaryDigits.length !== 11) {
    return false;
  }

  const tenantDigits = normalizeDigits(tenantCpfCnpj ?? '');
  if (!tenantDigits) {
    return true;
  }

  return tenantDigits !== beneficiaryDigits;
}

export function resolveTransferOperationFromAsaas(operationType: string | null | undefined): 'PIX' | 'TED' {
  return operationType === 'PIX' ? 'PIX' : 'TED';
}

export function estimateTransferFee(
  fees: GetTransferFeesOutput | null,
  operation: 'PIX' | 'TED',
): number {
  if (!fees) return 0;

  const feeConfig = operation === 'PIX' ? fees.pix : fees.ted;
  if (feeConfig.feeValue == null || feeConfig.feeValue <= 0) {
    return 0;
  }

  return feeConfig.feeValue;
}

export function estimateTransferDebitAmount(
  value: number,
  fees: GetTransferFeesOutput | null,
  operation: 'PIX' | 'TED',
): number {
  return Number((value + estimateTransferFee(fees, operation)).toFixed(2));
}

export function resolveTenantTransferContext(tenantCpfCnpj: string | null | undefined): {
  tenantDocumentType: 'CPF' | 'CNPJ' | null;
  tenantDocumentLastDigits: string | null;
  tenantDocumentNormalized: string | null;
} {
  const digits = normalizeDigits(tenantCpfCnpj ?? '');
  if (digits.length === 11) {
    return {
      tenantDocumentType: 'CPF',
      tenantDocumentLastDigits: digits.slice(-2),
      tenantDocumentNormalized: digits,
    };
  }
  if (digits.length === 14) {
    return {
      tenantDocumentType: 'CNPJ',
      tenantDocumentLastDigits: digits.slice(-2),
      tenantDocumentNormalized: digits,
    };
  }
  return {
    tenantDocumentType: null,
    tenantDocumentLastDigits: null,
    tenantDocumentNormalized: null,
  };
}

export function buildPixTransferAsaasPayload(params: {
  value: number;
  destination: Extract<WithdrawDestination, { type: 'PIX' }>;
  description?: string;
  scheduleDate?: string;
  externalReference: string;
}): CreatePixTransferInput {
  return {
    value: params.value,
    pixAddressKey: params.destination.pixAddressKey,
    pixAddressKeyType: params.destination.pixAddressKeyType,
    description: params.description,
    scheduleDate: params.scheduleDate,
    externalReference: params.externalReference,
  };
}

export function buildBankTransferAsaasPayload(params: {
  value: number;
  destination: Extract<WithdrawDestination, { type: 'BANK_ACCOUNT' }>;
  description?: string;
  scheduleDate?: string;
  externalReference: string;
  accountNameLabel: string;
}): CreateBankTransferInput {
  return {
    value: params.value,
    bankAccount: {
      bank: params.destination.bank,
      accountName: params.accountNameLabel,
      ownerName: params.destination.ownerName,
      ownerBirthDate: params.destination.ownerBirthDate,
      cpfCnpj: params.destination.cpfCnpj,
      agency: params.destination.agency,
      account: params.destination.account,
      accountDigit: params.destination.accountDigit,
      bankAccountType: params.destination.bankAccountType,
      ispb: params.destination.ispb,
    },
    description: params.description,
    scheduleDate: params.scheduleDate,
    externalReference: params.externalReference,
  };
}

export function isCancellableAsaasTransfer(transfer: {
  status?: string;
  canBeCancelled?: boolean;
}): boolean {
  if (typeof transfer.canBeCancelled === 'boolean') {
    return transfer.canBeCancelled;
  }

  return transfer.status === 'PENDING';
}
