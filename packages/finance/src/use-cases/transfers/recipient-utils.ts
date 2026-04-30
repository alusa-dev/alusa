import type { WithdrawDestination } from '../request-withdraw';

export type PixRecipientMetadata = {
  recipientName?: string | null;
  recipientDocumentMasked?: string | null;
  recipientBank?: string | null;
  recipientPixKeyMasked?: string | null;
};

export type RecipientSummary = {
  type: WithdrawDestination['type'];
  label: string;
  detail: string;
  key: string;
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

function maskPixKey(value: string, type: string): string {
  if (type === 'PHONE') {
    const digits = normalizeDigits(value);
    if (digits.length >= 4) return `${digits.slice(0, 2)}••••••${digits.slice(-2)}`;
  }

  if (type === 'CPF' || type === 'CNPJ') {
    return formatCpfCnpj(value);
  }

  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (local && domain) return `${local.slice(0, 2)}•••@${domain}`;
  }

  if (value.length > 8) return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseWithdrawDestination(raw: unknown): WithdrawDestination | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  if (candidate.type === 'PIX') {
    if (typeof candidate.pixAddressKey !== 'string' || typeof candidate.pixAddressKeyType !== 'string') {
      return null;
    }

    return {
      type: 'PIX',
      pixAddressKey: candidate.pixAddressKey,
      pixAddressKeyType: candidate.pixAddressKeyType as WithdrawDestination extends infer T
        ? T extends { type: 'PIX'; pixAddressKeyType: infer P }
          ? P
          : never
        : never,
      saveRecipient: typeof candidate.saveRecipient === 'boolean' ? candidate.saveRecipient : undefined,
      recipientName: normalizeOptionalString(candidate.recipientName),
      recipientDocumentMasked: normalizeOptionalString(candidate.recipientDocumentMasked),
      recipientBank: normalizeOptionalString(candidate.recipientBank),
      recipientPixKeyMasked: normalizeOptionalString(candidate.recipientPixKeyMasked),
    };
  }

  if (candidate.type === 'BANK_ACCOUNT') {
    const bank = candidate.bank as { code?: unknown } | undefined;
    if (
      !bank ||
      typeof bank.code !== 'string' ||
      typeof candidate.ownerName !== 'string' ||
      typeof candidate.cpfCnpj !== 'string' ||
      typeof candidate.agency !== 'string' ||
      typeof candidate.account !== 'string' ||
      typeof candidate.accountDigit !== 'string'
    ) {
      return null;
    }

    return {
      type: 'BANK_ACCOUNT',
      bank: { code: bank.code },
      accountName: typeof candidate.accountName === 'string' ? candidate.accountName : undefined,
      ownerName: candidate.ownerName,
      ownerBirthDate:
        typeof candidate.ownerBirthDate === 'string' ? candidate.ownerBirthDate : undefined,
      cpfCnpj: candidate.cpfCnpj,
      agency: candidate.agency,
      account: candidate.account,
      accountDigit: candidate.accountDigit,
      bankAccountType:
        candidate.bankAccountType === 'CONTA_CORRENTE' || candidate.bankAccountType === 'CONTA_POUPANCA'
          ? candidate.bankAccountType
          : undefined,
      ispb: typeof candidate.ispb === 'string' ? candidate.ispb : undefined,
    };
  }

  return null;
}

export function mergePixRecipientMetadata(
  destination: WithdrawDestination,
  metadata: PixRecipientMetadata | null | undefined,
): WithdrawDestination {
  if (destination.type !== 'PIX' || !metadata) {
    return destination;
  }

  const nextRecipientName = normalizeOptionalString(metadata.recipientName);
  const nextRecipientDocumentMasked = normalizeOptionalString(metadata.recipientDocumentMasked);
  const nextRecipientBank = normalizeOptionalString(metadata.recipientBank);
  const nextRecipientPixKeyMasked = normalizeOptionalString(metadata.recipientPixKeyMasked);

  if (
    !nextRecipientName
    && !nextRecipientDocumentMasked
    && !nextRecipientBank
    && !nextRecipientPixKeyMasked
  ) {
    return destination;
  }

  return {
    ...destination,
    saveRecipient: destination.saveRecipient,
    recipientName: nextRecipientName ?? destination.recipientName,
    recipientDocumentMasked: nextRecipientDocumentMasked ?? destination.recipientDocumentMasked,
    recipientBank: nextRecipientBank ?? destination.recipientBank,
    recipientPixKeyMasked: nextRecipientPixKeyMasked ?? destination.recipientPixKeyMasked,
  };
}

export function summarizeWithdrawDestination(destination: WithdrawDestination): RecipientSummary {
  if (destination.type === 'PIX') {
    const keyMasked = destination.recipientPixKeyMasked || maskPixKey(destination.pixAddressKey, destination.pixAddressKeyType);
    const detail = [
      destination.recipientDocumentMasked,
      destination.recipientBank,
      keyMasked,
    ]
      .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
      .join(' • ');

    const key = `PIX:${destination.pixAddressKeyType}:${destination.pixAddressKey}`;
    return {
      type: 'PIX',
      label: destination.recipientName || `Pix ${destination.pixAddressKeyType}`,
      detail,
      key,
    };
  }

  const key = [
    'BANK',
    destination.bank.code,
    destination.agency,
    destination.account,
    destination.accountDigit,
    normalizeDigits(destination.cpfCnpj),
  ].join(':');

  return {
    type: 'BANK_ACCOUNT',
    label: destination.ownerName,
    detail: `Banco ${destination.bank.code} • Ag ${destination.agency} • Conta ${destination.account}-${destination.accountDigit}`,
    key,
  };
}