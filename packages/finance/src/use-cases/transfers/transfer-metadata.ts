import type { AsaasTransfer } from '@alusa/asaas';

import { parseWithdrawDestination } from './recipient-utils';

export type TransferResolvedMetadata = {
  operation: 'PIX' | 'TED';
  recipientName: string | null;
  cpfCnpjMasked: string | null;
  bankName: string | null;
  pixKeyMasked: string | null;
  agency: string | null;
  account: string | null;
  accountDigit: string | null;
  accountType: string | null;
};

export type TransferMetadataFragment = Partial<Omit<TransferResolvedMetadata, 'operation'>> & {
  operation?: 'PIX' | 'TED' | null;
};

type TransferWebhookBank = {
  name?: string | null;
  code?: string | null;
};

type TransferWebhookBankAccount = {
  ownerName?: string | null;
  cpfCnpj?: string | null;
  bank?: TransferWebhookBank | null;
  agency?: string | null;
  account?: string | null;
  accountDigit?: string | null;
  pixAddressKey?: string | null;
};

type TransferWebhookPayload = {
  transfer?: {
    netValue?: number | null;
    transferFee?: number | null;
    operationType?: string | null;
    bankAccount?: TransferWebhookBankAccount | null;
  } | null;
};

export type TransferWebhookMetadata = TransferMetadataFragment & {
  netValue: number | null;
  feeValue: number | null;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

function formatCpfCnpj(value: string): string {
  const digits = normalizeDigits(value);

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }

  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  }

  return value;
}

function inferPixKeyType(value: string): 'PHONE' | 'EMAIL' | 'CPF' | 'CNPJ' | 'EVP' {
  const digits = normalizeDigits(value);
  if (value.includes('@')) return 'EMAIL';
  if (/^[0-9a-fA-F-]{32,36}$/.test(value.trim())) return 'EVP';
  if (digits.length === 11) return 'CPF';
  if (digits.length === 14) return 'CNPJ';
  return 'PHONE';
}

function maskPixKey(value: string): string {
  const type = inferPixKeyType(value);

  if (type === 'PHONE') {
    const digits = normalizeDigits(value);
    if (digits.length >= 4) return `${digits.slice(0, 2)}••••••${digits.slice(-2)}`;
  }

  if (type === 'CPF' || type === 'CNPJ') {
    return formatCpfCnpj(value);
  }

  if (type === 'EMAIL') {
    const [local, domain] = value.split('@');
    if (local && domain) return `${local.slice(0, 2)}•••@${domain}`;
  }

  if (value.length > 8) return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  return value;
}

export function maskCpfCnpj(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  const digits = value?.replace(/\D+/g, '') ?? '';

  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }

  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }

  if (trimmed.includes('*')) {
    return trimmed;
  }

  return null;
}

export function resolveBankDisplayName(
  bank: (TransferWebhookBank | AsaasTransfer['bankAccount'] extends infer T ? T extends { bank?: infer B } ? B : never : never) | null | undefined,
): string | null {
  if (!bank || typeof bank !== 'object') return null;

  const candidate = bank as TransferWebhookBank;
  const trimmedName = candidate.name?.trim();
  if (trimmedName) return trimmedName;

  const trimmedCode = candidate.code?.trim();
  if (trimmedCode) return `Banco ${trimmedCode}`;

  return null;
}

function resolveTransferOperation(value: string | null | undefined): 'PIX' | 'TED' | null {
  if (value === 'PIX') return 'PIX';
  if (value) return 'TED';
  return null;
}

export function extractWebhookTransferMetadata(payload: unknown): TransferWebhookMetadata | null {
  if (!payload || typeof payload !== 'object') return null;

  const transfer = (payload as TransferWebhookPayload).transfer;
  const bankAccount = transfer?.bankAccount;
  if (!bankAccount) return null;

  const recipientName = bankAccount.ownerName?.trim() || null;
  const cpfCnpjMasked = maskCpfCnpj(bankAccount.cpfCnpj ?? null);
  const bankName = resolveBankDisplayName(bankAccount.bank ?? null);
  const pixKeyMasked = bankAccount.pixAddressKey?.trim() ? maskPixKey(bankAccount.pixAddressKey.trim()) : null;

  if (!recipientName && !cpfCnpjMasked && !bankName && !pixKeyMasked) {
    return null;
  }

  return {
    recipientName,
    cpfCnpjMasked,
    bankName,
    pixKeyMasked,
    agency: bankAccount.agency?.trim() || null,
    account: bankAccount.account?.trim() || null,
    accountDigit: bankAccount.accountDigit?.trim() || null,
    netValue: typeof transfer?.netValue === 'number' ? transfer.netValue : null,
    feeValue: typeof transfer?.transferFee === 'number' ? transfer.transferFee : null,
    operation: resolveTransferOperation(transfer?.operationType),
  };
}

export function extractOfficialTransferMetadata(transfer: AsaasTransfer | null | undefined): TransferMetadataFragment | null {
  if (!transfer) return null;

  const bankAccount = transfer.bankAccount;
  const internalAccount = transfer.account;

  return {
    operation: resolveTransferOperation(transfer.operationType),
    recipientName: bankAccount?.ownerName?.trim() || internalAccount?.name?.trim() || null,
    cpfCnpjMasked: maskCpfCnpj(bankAccount?.cpfCnpj ?? internalAccount?.cpfCnpj ?? null),
    bankName: resolveBankDisplayName(bankAccount?.bank ?? null),
    pixKeyMasked: bankAccount?.pixAddressKey?.trim() ? maskPixKey(bankAccount.pixAddressKey.trim()) : null,
    agency: bankAccount?.agency?.trim() || null,
    account: bankAccount?.account?.trim() || null,
    accountDigit: bankAccount?.accountDigit?.trim() || null,
  };
}

export function resolveTransferMetadata(rawDestination: unknown, description: string | null): TransferResolvedMetadata {
  const destination = parseWithdrawDestination(rawDestination);

  if (!destination) {
    return {
      operation: 'TED',
      recipientName: description,
      cpfCnpjMasked: null,
      bankName: null,
      pixKeyMasked: null,
      agency: null,
      account: null,
      accountDigit: null,
      accountType: null,
    };
  }

  if (destination.type === 'PIX') {
    return {
      operation: 'PIX',
      recipientName: destination.recipientName ?? description ?? null,
      cpfCnpjMasked: maskCpfCnpj(destination.recipientDocumentMasked ?? null),
      bankName: destination.recipientBank ?? 'Pix',
      pixKeyMasked: destination.recipientPixKeyMasked ?? maskPixKey(destination.pixAddressKey),
      agency: null,
      account: null,
      accountDigit: null,
      accountType: null,
    };
  }

  return {
    operation: 'TED',
    recipientName: destination.ownerName,
    cpfCnpjMasked: maskCpfCnpj(destination.cpfCnpj),
    bankName: destination.bank.code ? `Banco ${destination.bank.code}` : null,
    pixKeyMasked: null,
    agency: destination.agency,
    account: destination.account,
    accountDigit: destination.accountDigit,
    accountType: destination.bankAccountType ?? null,
  };
}

export function mergeTransferMetadata(
  base: TransferResolvedMetadata,
  ...sources: Array<TransferMetadataFragment | null | undefined>
): TransferResolvedMetadata {
  return sources.reduce<TransferResolvedMetadata>((current, source) => {
    if (!source) return current;

    return {
      operation: source.operation ?? current.operation,
      recipientName: source.recipientName ?? current.recipientName,
      cpfCnpjMasked: source.cpfCnpjMasked ?? current.cpfCnpjMasked,
      bankName: source.bankName ?? current.bankName,
      pixKeyMasked: source.pixKeyMasked ?? current.pixKeyMasked,
      agency: source.agency ?? current.agency,
      account: source.account ?? current.account,
      accountDigit: source.accountDigit ?? current.accountDigit,
      accountType: source.accountType ?? current.accountType,
    };
  }, base);
}

export function resolveOfficialFeeValue(
  transfer: AsaasTransfer | null | undefined,
  webhook: TransferWebhookMetadata | null,
  value: number,
): number | null {
  if (typeof transfer?.transferFee === 'number') return transfer.transferFee;
  if (typeof webhook?.feeValue === 'number') return webhook.feeValue;
  if (typeof transfer?.netValue === 'number') {
    return Math.max(Number((transfer.value - transfer.netValue).toFixed(2)), 0);
  }
  if (typeof webhook?.netValue === 'number') {
    return Math.max(Number((value - webhook.netValue).toFixed(2)), 0);
  }
  return null;
}

export function resolveOfficialNetValue(
  transfer: AsaasTransfer | null | undefined,
  webhook: TransferWebhookMetadata | null,
  value: number,
): number {
  if (typeof transfer?.netValue === 'number') return transfer.netValue;
  if (typeof webhook?.netValue === 'number') return webhook.netValue;
  return value;
}