import type { WithdrawDestination } from '../request-withdraw';

import { parseWithdrawDestination } from './recipient-utils';

type CanonicalTransferDestination =
  | {
      type: 'PIX';
      pixAddressKeyType: WithdrawDestination extends infer T
        ? T extends { type: 'PIX'; pixAddressKeyType: infer P }
          ? P
          : never
        : never;
      pixAddressKey: string;
    }
  | {
      type: 'BANK_ACCOUNT';
      bankCode: string;
      accountName: string | null;
      ownerName: string;
      ownerBirthDate: string | null;
      cpfCnpj: string;
      agency: string;
      account: string;
      accountDigit: string;
      bankAccountType: 'CONTA_CORRENTE' | 'CONTA_POUPANCA' | null;
      ispb: string | null;
    };

export type TransferRequestIntent = {
  value: string;
  description: string | null;
  scheduleDate: string | null;
  destination: CanonicalTransferDestination;
};

type PersistedTransferRequestIntentSource = {
  value: number | string | { toString(): string };
  description?: string | null;
  scheduleDate?: string | Date | null;
  destination: unknown;
};

type AuthorizationPayloadTransfer = {
  externalReference?: string | null;
  value?: number | null;
  scheduleDate?: string | null;
  description?: string | null;
  operationType?: string | null;
  bankAccount?: {
    bank?: {
      code?: string | null;
    } | null;
    ownerName?: string | null;
    cpfCnpj?: string | null;
    agency?: string | null;
    account?: string | null;
    accountDigit?: string | null;
    pixAddressKey?: string | null;
  } | null;
};

function normalizeDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\s+/g, ' ').toLowerCase() : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return normalizeText(value);
}

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function normalizeMoney(value: number | string | { toString(): string }): string {
  const asNumber = Number(typeof value === 'number' ? value : value.toString());
  return Number.isFinite(asNumber) ? asNumber.toFixed(2) : '0.00';
}

function normalizePixKeyType(
  value: WithdrawDestination extends infer T
    ? T extends { type: 'PIX'; pixAddressKeyType: infer P }
      ? P
      : never
    : never,
) {
  return value;
}

function normalizePixKey(
  value: string,
  type: WithdrawDestination extends infer T
    ? T extends { type: 'PIX'; pixAddressKeyType: infer P }
      ? P
      : never
    : never,
): string {
  const trimmed = value.trim();

  switch (type) {
    case 'CPF':
    case 'CNPJ':
    case 'PHONE':
      return normalizeDigits(trimmed);
    case 'EMAIL':
      return trimmed.toLowerCase();
    case 'EVP':
    default:
      return trimmed.toLowerCase();
  }
}

function canonicalizeDestination(destination: WithdrawDestination): CanonicalTransferDestination {
  if (destination.type === 'PIX') {
    return {
      type: 'PIX',
      pixAddressKeyType: normalizePixKeyType(destination.pixAddressKeyType),
      pixAddressKey: normalizePixKey(destination.pixAddressKey, destination.pixAddressKeyType),
    };
  }

  return {
    type: 'BANK_ACCOUNT',
    bankCode: normalizeDigits(destination.bank.code),
    accountName: normalizeOptionalText(destination.accountName),
    ownerName: normalizeText(destination.ownerName) ?? '',
    ownerBirthDate: normalizeDateOnly(destination.ownerBirthDate),
    cpfCnpj: normalizeDigits(destination.cpfCnpj),
    agency: normalizeDigits(destination.agency),
    account: normalizeDigits(destination.account),
    accountDigit: normalizeDigits(destination.accountDigit),
    bankAccountType: destination.bankAccountType ?? null,
    ispb: normalizeOptionalText(destination.ispb),
  };
}

export function buildTransferRequestIntentFromInput(input: {
  value: number;
  description?: string | null;
  scheduleDate?: string | null;
  destination: WithdrawDestination;
}): TransferRequestIntent {
  return {
    value: normalizeMoney(input.value),
    description: normalizeOptionalText(input.description),
    scheduleDate: normalizeDateOnly(input.scheduleDate),
    destination: canonicalizeDestination(input.destination),
  };
}

export function buildTransferRequestIntentFromRecord(
  source: PersistedTransferRequestIntentSource,
): TransferRequestIntent | null {
  const destination = parseWithdrawDestination(source.destination);
  if (!destination) return null;

  return {
    value: normalizeMoney(source.value),
    description: normalizeOptionalText(source.description),
    scheduleDate: normalizeDateOnly(source.scheduleDate),
    destination: canonicalizeDestination(destination),
  };
}

export function areTransferRequestIntentsEquivalent(
  left: TransferRequestIntent,
  right: TransferRequestIntent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyTransferAuthorizationPayload(params: {
  expectedExternalReference: string;
  expectedIntent: TransferRequestIntent;
  transfer: AuthorizationPayloadTransfer;
}): { matches: true } | { matches: false; refuseReason: string } {
  if ((params.transfer.externalReference ?? null) !== params.expectedExternalReference) {
    return { matches: false, refuseReason: 'External reference divergente' };
  }

  if (params.transfer.value != null && normalizeMoney(params.transfer.value) !== params.expectedIntent.value) {
    return { matches: false, refuseReason: 'Valor divergente' };
  }

  const scheduleDate = normalizeDateOnly(params.transfer.scheduleDate);
  if (scheduleDate !== params.expectedIntent.scheduleDate) {
    return { matches: false, refuseReason: 'Data agendada divergente' };
  }

  const description = normalizeOptionalText(params.transfer.description);
  if (description !== params.expectedIntent.description) {
    return { matches: false, refuseReason: 'Descricao divergente' };
  }

  if (params.expectedIntent.destination.type === 'PIX') {
    if ((params.transfer.operationType ?? 'PIX').toUpperCase() !== 'PIX') {
      return { matches: false, refuseReason: 'Tipo de operacao divergente' };
    }

    const payloadPixKey = params.transfer.bankAccount?.pixAddressKey;
    if (!payloadPixKey) {
      return { matches: false, refuseReason: 'Chave Pix ausente' };
    }

    const normalizedPayloadPixKey = normalizePixKey(
      payloadPixKey,
      params.expectedIntent.destination.pixAddressKeyType,
    );

    if (normalizedPayloadPixKey !== params.expectedIntent.destination.pixAddressKey) {
      return { matches: false, refuseReason: 'Chave Pix divergente' };
    }

    return { matches: true };
  }

  if ((params.transfer.operationType ?? 'TED').toUpperCase() === 'PIX') {
    return { matches: false, refuseReason: 'Tipo de operacao divergente' };
  }

  const bankAccount = params.transfer.bankAccount;
  if (!bankAccount) {
    return { matches: false, refuseReason: 'Conta bancaria ausente' };
  }

  const destination = params.expectedIntent.destination;

  const payloadCpfCnpj = normalizeDigits(bankAccount.cpfCnpj);
  if (payloadCpfCnpj && payloadCpfCnpj !== destination.cpfCnpj) {
    return { matches: false, refuseReason: 'Documento do favorecido divergente' };
  }

  const payloadOwnerName = normalizeText(bankAccount.ownerName);
  if (payloadOwnerName && payloadOwnerName !== destination.ownerName) {
    return { matches: false, refuseReason: 'Titular divergente' };
  }

  const payloadBankCode = normalizeDigits(bankAccount.bank?.code);
  if (payloadBankCode && payloadBankCode !== destination.bankCode) {
    return { matches: false, refuseReason: 'Banco divergente' };
  }

  const payloadAgency = normalizeDigits(bankAccount.agency);
  if (payloadAgency && payloadAgency !== destination.agency) {
    return { matches: false, refuseReason: 'Agencia divergente' };
  }

  const payloadAccount = normalizeDigits(bankAccount.account);
  if (payloadAccount && payloadAccount !== destination.account) {
    return { matches: false, refuseReason: 'Conta divergente' };
  }

  const payloadAccountDigit = normalizeDigits(bankAccount.accountDigit);
  if (payloadAccountDigit && payloadAccountDigit !== destination.accountDigit) {
    return { matches: false, refuseReason: 'Digito da conta divergente' };
  }

  return { matches: true };
}