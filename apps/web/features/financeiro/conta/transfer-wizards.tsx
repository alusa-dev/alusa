'use client';

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pushToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { formatCpfCnpjBR, formatPhoneBR } from '@/lib/formatters';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { Search } from '@/components/icons/icons';
import type { GetTransferFeesOutput } from '@alusa/finance/client';
import {
  estimateTransferDebitAmount,
  estimateTransferFee,
  isValidPixPhoneKey,
  normalizeWithdrawDestinationForAsaas,
  requiresOwnerBirthDate,
} from '@alusa/finance/client';

import { formatCurrency } from '../extrato/utils/extrato-formatters';
import { formatDate } from '../extrato/utils/extrato-formatters';

export type TransferDestinationType = 'PIX' | 'BANK_ACCOUNT';
export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
export type BankAccountType = 'CONTA_CORRENTE' | 'CONTA_POUPANCA';

const WIZARD_CONTROL_CLASS = 'h-10 rounded-lg border-slate-200 bg-white text-sm shadow-sm';

export type TransferRecipient = {
  id: string;
  type: TransferDestinationType;
  label: string;
  detail: string;
  lastUsedAt: string;
  destination:
    | {
        type: 'PIX';
        pixAddressKey: string;
        pixAddressKeyType: PixKeyType;
        recipientName?: string;
        recipientDocumentMasked?: string;
        recipientBank?: string;
        recipientPixKeyMasked?: string;
      }
    | {
        type: 'BANK_ACCOUNT';
        bank: { code: string };
        accountName?: string;
        ownerName: string;
        ownerBirthDate?: string;
        cpfCnpj: string;
        agency: string;
        account: string;
        accountDigit?: string;
        bankAccountType?: BankAccountType;
        ispb?: string;
      };
};

type PixLookupResult = {
  ownerName: string | null;
  ownerDocumentMasked: string | null;
  institutionName: string | null;
  bankName: string | null;
  bankCode: string | null;
};



type TransferFormState = {
  type: TransferDestinationType;
  amount: string;
  description: string;
  scheduleDate: string;
  pixAddressKey: string;
  pixAddressKeyType: PixKeyType;
  bankCode: string;
  accountName: string;
  ownerName: string;
  ownerBirthDate: string;
  cpfCnpj: string;
  agency: string;
  account: string;
  accountDigit: string;
  bankAccountType: BankAccountType;
  ispb: string;
};



const TRANSFER_INITIAL_STATE: TransferFormState = {
  type: 'PIX',
  amount: '',
  description: '',
  scheduleDate: '',
  pixAddressKey: '',
  pixAddressKeyType: 'EVP',
  bankCode: '',
  accountName: '',
  ownerName: '',
  ownerBirthDate: '',
  cpfCnpj: '',
  agency: '',
  account: '',
  accountDigit: '',
  bankAccountType: 'CONTA_CORRENTE',
  ispb: '',
};



function sanitizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Não foi possível concluir a operação.';
}

function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapTransferErrorMessage(message: string) {
  switch (message) {
    case 'FEATURE_DISABLED':
      return 'As transferências desta conta estão temporariamente desabilitadas.';
    case 'KYC_NAO_APROVADO':
      return 'A conta ainda está em validação e não pode transferir neste momento.';
    case 'SALDO_INSUFICIENTE':
      return 'Saldo insuficiente para concluir a transferência.';
    case 'SALDO_INSUFICIENTE_PARA_TAXA':
      return 'Saldo insuficiente para cobrir o valor e a taxa estimada da transferência.';
    case 'OWNER_BIRTH_DATE_OBRIGATORIO':
      return 'Informe a data de nascimento do titular quando o favorecido for pessoa física de outro CPF.';
    case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
      return 'A conta financeira ainda não está configurada para movimentação.';
    case 'CREDENCIAIS_ASAAS_INVALIDAS':
      return 'A subconta financeira está com credenciais inválidas ou expiradas. Reconecte a conta antes de tentar novamente.';
    case 'PIX_KEY_NAO_ENCONTRADA':
      return 'A chave Pix informada não foi encontrada. Se estiver em sandbox, use uma chave fictícia do BACEN ou uma chave válida de outra conta sandbox.';
    case 'CHAVE_PIX_NAO_ENCONTRADA':
      return 'Não encontramos um titular para esta chave Pix. Confira os dados e tente novamente.';
    case 'CONSULTA_CHAVE_PIX_INDISPONIVEL':
      return 'Não foi possível consultar o titular agora. Tente novamente em instantes.';
    case 'TRANSFERENCIA_DUPLICADA':
      return 'Já existe uma transferência idêntica em processamento recente. Aguarde alguns minutos antes de tentar novamente.';
    case 'IDEMPOTENCY_PAYLOAD_CONFLICT':
      return 'Já existe uma tentativa anterior com a mesma chave de proteção, mas com dados diferentes. Feche o fluxo atual e tente novamente.';
    case 'AUTORIZACAO_CRITICA_NECESSARIA':
      return 'A conta exige autorização crítica para este saque. Configure a whitelist de IP e o webhook de autorização externa antes de automatizar a transferência.';
    case 'IDEMPOTENCY_KEY_OBRIGATORIO':
      return 'A solicitação não pode ser protegida contra duplicidade. Tente novamente.';
    case 'REAUTENTICACAO_INDISPONIVEL':
      return 'Sua sessão não possui os dados necessários para revalidar o saque. Entre novamente antes de tentar.';
    case 'SENHA_INVALIDA':
      return 'A senha informada não confere com a sessão atual.';
    default:
      return message;
  }
}


function parseAmountNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;

  const amount = Number(digits) / 100;
  return Number.isFinite(amount) ? amount : null;
}

function formatCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  const amount = Number(digits) / 100;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}


function toApiAmountString(value: string) {
  const amount = parseAmountNumber(value);
  return amount == null ? '' : amount.toFixed(2);
}

function isValidDecimalAmount(value: string) {
  const amount = parseAmountNumber(value);
  return amount != null && amount > 0;
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, '');
}

function isRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function isValidCpf(value: string) {
  const digits = normalizeDigits(value);
  if (digits.length !== 11 || isRepeatedDigits(digits)) return false;

  let total = 0;
  for (let index = 0; index < 9; index += 1) {
    total += Number(digits[index]) * (10 - index);
  }

  const firstCheck = (total * 10) % 11;
  if ((firstCheck === 10 ? 0 : firstCheck) !== Number(digits[9])) return false;

  total = 0;
  for (let index = 0; index < 10; index += 1) {
    total += Number(digits[index]) * (11 - index);
  }

  const secondCheck = (total * 10) % 11;
  return (secondCheck === 10 ? 0 : secondCheck) === Number(digits[10]);
}

function isValidCnpj(value: string) {
  const digits = normalizeDigits(value);
  if (digits.length !== 14 || isRepeatedDigits(digits)) return false;

  const calc = (base: string, factors: number[]) => {
    const total = factors.reduce((sum, factor, index) => sum + Number(base[index]) * factor, 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstCheck = calc(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstCheck !== Number(digits[12])) return false;

  const secondCheck = calc(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondCheck === Number(digits[13]);
}

function isValidCpfCnpj(value: string) {
  const digits = normalizeDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string) {
  return isValidPixPhoneKey(value);
}

function isValidEvp(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function formatEvpKey(value: string) {
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 32);
  const parts = [8, 4, 4, 4, 12];
  let cursor = 0;

  return parts
    .map((size) => {
      const segment = hex.slice(cursor, cursor + size);
      cursor += size;
      return segment;
    })
    .filter(Boolean)
    .join('-');
}

function formatPixPhone(value: string) {
  const digits = normalizeDigits(value).slice(0, 13);
  if (!digits) return '';
  if (digits.length <= 2) return `+${digits}`;
  return `+${digits.slice(0, 2)} ${formatPhoneBR(digits.slice(2))}`;
}

function formatPixKeyInput(value: string) {
  return value;
}

function normalizePixKey(value: string, type?: PixKeyType | null) {
  const resolvedType = type ?? detectPixKeyType(value);

  switch (resolvedType) {
    case 'EMAIL':
      return value.trim().toLowerCase();
    case 'PHONE':
    case 'CPF':
    case 'CNPJ':
      return normalizeDigits(value);
    case 'EVP':
      return value.trim().toLowerCase().replace(/-/g, '');
    default:
      return value.trim().toLowerCase();
  }
}

function formatPixKeyForDisplay(value: string, type: PixKeyType) {
  switch (type) {
    case 'CPF':
    case 'CNPJ':
      return formatCpfCnpjBR(normalizeDigits(value));
    case 'PHONE':
      return formatPixPhone(value);
    case 'EMAIL':
      return value.trim().toLowerCase();
    case 'EVP':
      return formatEvpKey(value);
  }
}

function detectPixKeyType(value: string): PixKeyType | null {
  const normalized = value.trim();

  if (!normalized) return null;
  if (isValidEmail(normalized)) return 'EMAIL';
  if (isValidEvp(normalized)) return 'EVP';
  if (isValidCpf(normalized)) return 'CPF';
  if (isValidCnpj(normalized)) return 'CNPJ';
  if (isValidPhone(normalized)) return 'PHONE';

  return null;
}

function formatPixKeyType(type: PixKeyType) {
  switch (type) {
    case 'CPF':
      return 'CPF';
    case 'CNPJ':
      return 'CNPJ';
    case 'EMAIL':
      return 'E-mail';
    case 'PHONE':
      return 'Telefone';
    case 'EVP':
      return 'Chave aleatória (Pix)';
  }
}

function isPixKeyValid(value: string, type: PixKeyType | null) {
  if (!type) return false;

  switch (type) {
    case 'CPF':
      return isValidCpf(value);
    case 'CNPJ':
      return isValidCnpj(value);
    case 'EMAIL':
      return isValidEmail(value);
    case 'PHONE':
      return isValidPhone(value);
    case 'EVP':
      return isValidEvp(value);
  }
}

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDateForDisplay(value: string | null | undefined) {
  if (!value) return 'Não agendada';
  return formatDate(value);
}

function getRecipientPrimaryLine(recipient: TransferRecipient) {
  if (recipient.destination.type === 'PIX') {
    return [recipient.label, recipient.destination.recipientDocumentMasked]
      .filter(Boolean)
      .join(' ');
  }

  return recipient.label;
}

function getRecipientSecondaryLine(recipient: TransferRecipient) {
  if (recipient.destination.type === 'PIX' && recipient.destination.recipientBank) {
    return `Banco: ${recipient.destination.recipientBank}`;
  }

  return recipient.detail;
}

function buildTransferValidation(
  form: TransferFormState,
  maxAmount: number,
  pixKeyType: PixKeyType | null,
  transferContext: TransferWizardContext | null,
  fees: GetTransferFeesOutput | null,
) {
  const errors: string[] = [];
  const amountIsValid = isValidDecimalAmount(form.amount);
  const amountValue = parseAmountNumber(form.amount);
  const estimatedOperation = form.type === 'PIX' ? 'PIX' : 'TED';
  const estimatedDebit = amountValue != null ? estimateTransferDebitAmount(amountValue, fees, estimatedOperation) : null;

  if (!amountIsValid) {
    errors.push('Informe um valor valido.');
  } else if ((amountValue ?? 0) > maxAmount) {
    errors.push('O valor informado excede o saldo disponível.');
  } else if (estimatedDebit != null && estimatedDebit > maxAmount) {
    errors.push('O saldo disponível não cobre o valor somado à taxa estimada.');
  }

  if (form.type === 'PIX') {
    if (!form.pixAddressKey.trim()) {
      errors.push('Informe a chave Pix do destinatário.');
    } else if (!pixKeyType) {
      errors.push('Não foi possível reconhecer a chave Pix informada.');
    } else if (pixKeyType === 'PHONE' ? !isValidPixPhoneKey(form.pixAddressKey) : !isPixKeyValid(form.pixAddressKey, pixKeyType)) {
      errors.push(
        pixKeyType === 'PHONE'
          ? 'Informe o telefone Pix com DDD, 11 dígitos, sem +55.'
          : `A chave Pix não corresponde ao tipo ${formatPixKeyType(pixKeyType)}.`,
      );
    }
  }

  if (form.type === 'BANK_ACCOUNT') {
    if (!form.bankCode.trim()) errors.push('Informe o codigo do banco.');
    if (!form.ownerName.trim()) errors.push('Informe o nome do titular.');
    if (!isValidCpfCnpj(form.cpfCnpj)) errors.push('Informe um CPF ou CNPJ valido do titular.');
    if (!form.agency.trim()) errors.push('Informe a agencia.');
    if (!form.account.trim()) errors.push('Informe a conta.');
    if (!form.accountDigit.trim()) errors.push('Informe o digito da conta.');
    if (
      requiresOwnerBirthDate(transferContext?.tenantDocumentNormalized, form.cpfCnpj) &&
      !form.ownerBirthDate.trim()
    ) {
      errors.push('Informe a data de nascimento do titular favorecido.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: unknown };

  if (!response.ok) {
    const errorMessage =
      typeof json.error === 'string'
        ? json.error
        : typeof json.error === 'object' && json.error && 'message' in json.error
          ? String((json.error as { message?: string }).message)
          : `Erro ${response.status}`;
    throw new Error(errorMessage);
  }

  return json.data as T;
}


export type TransferWizardContext = {
  tenantDocumentType: 'CPF' | 'CNPJ' | null;
  tenantDocumentLastDigits: string | null;
  tenantDocumentNormalized: string | null;
};

function buildTransferPayload(form: TransferFormState, pixKeyType: PixKeyType) {
  if (form.type === 'PIX') {
    return {
      amount: toApiAmountString(form.amount),
      description: form.description || undefined,
      scheduleDate: form.scheduleDate || undefined,
      destination: normalizeWithdrawDestinationForAsaas({
        type: 'PIX' as const,
        pixAddressKey: form.pixAddressKey.trim(),
        pixAddressKeyType: pixKeyType,
        saveRecipient: false,
      }),
    };
  }

  return {
    amount: toApiAmountString(form.amount),
    description: form.description || undefined,
    scheduleDate: form.scheduleDate || undefined,
    destination: normalizeWithdrawDestinationForAsaas({
      type: 'BANK_ACCOUNT' as const,
      bank: { code: form.bankCode.trim() },
      accountName: form.accountName || undefined,
      ownerName: form.ownerName.trim(),
      ownerBirthDate: form.ownerBirthDate || undefined,
      cpfCnpj: form.cpfCnpj.trim(),
      agency: form.agency.trim(),
      account: form.account.trim(),
      accountDigit: form.accountDigit.trim(),
      bankAccountType: form.bankAccountType || undefined,
      ispb: form.ispb || undefined,
    }),
  };
}

function applySelectedRecipientToForm(
  recipient: TransferRecipient,
  current: TransferFormState,
): TransferFormState {
  if (recipient.destination.type === 'PIX') {
    return {
      ...TRANSFER_INITIAL_STATE,
      type: 'PIX',
      pixAddressKeyType: recipient.destination.pixAddressKeyType,
      amount: current.amount,
      description: current.description,
      scheduleDate: current.scheduleDate,
    };
  }

  return {
    ...applyRecipientToForm(recipient),
    amount: current.amount,
    description: current.description,
    scheduleDate: current.scheduleDate,
  };
}

function applyRecipientToForm(recipient: TransferRecipient): TransferFormState {
  if (recipient.destination.type === 'PIX') {
    return {
      ...TRANSFER_INITIAL_STATE,
      type: 'PIX',
      pixAddressKey: recipient.destination.pixAddressKey,
      pixAddressKeyType: recipient.destination.pixAddressKeyType,
      description: '',
    };
  }

  return {
    ...TRANSFER_INITIAL_STATE,
    type: 'BANK_ACCOUNT',
    bankCode: recipient.destination.bank.code,
    accountName: recipient.destination.accountName ?? '',
    ownerName: recipient.destination.ownerName,
    ownerBirthDate: recipient.destination.ownerBirthDate ?? '',
    cpfCnpj: recipient.destination.cpfCnpj,
    agency: recipient.destination.agency,
    account: recipient.destination.account,
    accountDigit: recipient.destination.accountDigit ?? '',
    bankAccountType: recipient.destination.bankAccountType ?? 'CONTA_CORRENTE',
    ispb: recipient.destination.ispb ?? '',
    description: '',
  };
}

function getWizardDefaultType(canPix: boolean, canTed: boolean): TransferDestinationType {
  if (canPix) return 'PIX';
  if (canTed) return 'BANK_ACCOUNT';
  return 'PIX';
}

function WizardDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  step,
  totalSteps,
  children,
  canGoBack,
  canProceed,
  nextLabel,
  onNext,
  onBack,
  loading,
  nextTestId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  children: React.ReactNode;
  canGoBack: boolean;
  canProceed: boolean;
  nextLabel: string;
  onNext: () => void;
  onBack: () => void;
  loading?: boolean;
  nextTestId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-0 shadow-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0 rounded-t-2xl border-b border-slate-200 bg-slate-50 px-4 py-5 md:px-8 md:py-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          <div className="mt-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
              <Progress
                value={(step / totalSteps) * 100}
                className="h-2 bg-transparent [&>div]:bg-primary"
                aria-label="Progresso do wizard financeiro"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((step / totalSteps) * 100)}
              />
            </div>
            <div className="mt-2 text-xs font-medium text-slate-600" aria-live="polite">
              Etapa {step} de {totalSteps}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-5 md:px-8 md:py-6 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
            style={{ scrollbarWidth: 'thin', scrollbarGutter: 'stable', scrollbarColor: '#d1d5db transparent' }}
          >
            <div className="mx-auto w-full max-w-4xl space-y-5">{children}</div>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-4 md:px-8">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={!canGoBack || loading}
              className="h-10 min-w-[120px] rounded-lg border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-100"
            >
              Voltar
            </Button>
            <Button
              type="button"
              className="h-10 min-w-[176px] rounded-lg bg-primary px-5 text-white shadow-none hover:bg-primary/90"
              disabled={!canProceed || loading}
              onClick={onNext}
              data-testid={nextTestId}
            >
              {loading ? 'Processando...' : nextLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WizardSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-none">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ChoiceCard({
  selected,
  disabled,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-0',
        selected
          ? 'border-violet-200/80 bg-[#e6d6fb]'
          : 'border-slate-200 bg-white hover:border-slate-300',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      )}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-none last:pb-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-right text-slate-900">{value}</span>
    </div>
  );
}

function RecipientCard({
  recipient,
  selected,
  deleting,
  canDelete,
  onSelect,
  onDelete,
}: {
  recipient: TransferRecipient;
  selected: boolean;
  deleting?: boolean;
  canDelete?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const initials = getInitials(recipient.label || recipient.detail || 'PX');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-0',
        selected
          ? 'border-violet-200/80 bg-[#e6d6fb]'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
      )}
    >
      <span className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        selected ? 'bg-primary text-white' : 'bg-primary/10 text-primary',
      )}>
        {initials || 'PX'}
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-semibold', selected ? 'text-primary' : 'text-slate-900')}>
          {getRecipientPrimaryLine(recipient)}
        </span>
        <span className={cn('mt-0.5 block truncate text-xs', selected ? 'text-primary/75' : 'text-slate-500')}>
          {getRecipientSecondaryLine(recipient)}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2 self-center">
        {canDelete && onDelete ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Excluir chave Pix ${recipient.label}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!deleting) onDelete();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                if (!deleting) onDelete();
              }
            }}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition',
              deleting ? 'cursor-wait opacity-60' : 'hover:border-primary/40 hover:bg-primary/10 hover:text-primary',
            )}
          >
            <Trash2 className="h-4 w-4" />
          </span>
        ) : null}
        {selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
            </svg>
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function TransferWizardDialog({
  open,
  onOpenChange,
  recipients,
  initialRecipient,
  canPix,
  canTed,
  maxAmount,
  fees,
  transferContext,
  onSuccess,
  onRecipientsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: TransferRecipient[];
  initialRecipient?: TransferRecipient | null;
  canPix: boolean;
  canTed: boolean;
  maxAmount: number;
  fees: GetTransferFeesOutput | null;
  transferContext: TransferWizardContext | null;
  onSuccess: () => Promise<void>;
  onRecipientsChange: () => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<TransferFormState>(() => ({
    ...TRANSFER_INITIAL_STATE,
    type: getWizardDefaultType(canPix, canTed),
  }));
  const [recipientId, setRecipientId] = useState('manual');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savePixKey, setSavePixKey] = useState(false);
  const [deletingRecipientId, setDeletingRecipientId] = useState<string | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey());
  const [pixLookup, setPixLookup] = useState<PixLookupResult | null>(null);
  const [pixLookupLoading, setPixLookupLoading] = useState(false);
  const [pixLookupError, setPixLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setRecipientId('manual');
      setRecipientSearch('');
      setSavePixKey(false);
      setPasswordDialogOpen(false);
      setCurrentPassword('');
      setCurrentPasswordError(null);
      setIdempotencyKey(makeIdempotencyKey());
      setPixLookup(null);
      setPixLookupError(null);
      setForm({ ...TRANSFER_INITIAL_STATE, type: getWizardDefaultType(canPix, canTed) });
      return;
    }

    if (initialRecipient) {
      setRecipientId(initialRecipient.id);
      setRecipientSearch('');
      setForm((current) => applySelectedRecipientToForm(initialRecipient, current));
    }
  }, [canPix, canTed, initialRecipient, open]);

  useEffect(() => () => undefined, []);

  const selectedRecipient = useMemo(
    () => recipients.find((item) => item.id === recipientId) ?? null,
    [recipientId, recipients],
  );
  const selectedPixRecipient = useMemo(
    () => (selectedRecipient?.destination.type === 'PIX' ? selectedRecipient : null),
    [selectedRecipient],
  );
  const selectedPixDestination = useMemo(() => {
    const destination = selectedPixRecipient?.destination;
    return destination?.type === 'PIX' ? destination : null;
  }, [selectedPixRecipient]);
  const resolvedPixKey = selectedPixDestination?.pixAddressKey ?? form.pixAddressKey;
  const detectedPixKeyType = useMemo(() => detectPixKeyType(form.pixAddressKey), [form.pixAddressKey]);
  const effectivePixKeyType =
    selectedPixDestination?.pixAddressKeyType
    ?? detectedPixKeyType
    ?? (form.pixAddressKeyType ?? null);
  const validation = useMemo(
    () =>
      buildTransferValidation(
        { ...form, pixAddressKey: resolvedPixKey },
        maxAmount,
        effectivePixKeyType,
        transferContext,
        fees,
      ),
    [effectivePixKeyType, fees, form, maxAmount, resolvedPixKey, transferContext],
  );
  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();

    return recipients
      .filter((recipient) => recipient.type === form.type)
      .filter((recipient) => {
        if (!query) return true;

        return [recipient.label, recipient.detail]
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [form.type, recipientSearch, recipients]);
  const amountNumber = parseAmountNumber(form.amount);
  const estimatedOperation = form.type === 'PIX' ? 'PIX' : 'TED';
  const estimatedFee = estimateTransferFee(fees, estimatedOperation);
  const estimatedDebit =
    amountNumber != null ? estimateTransferDebitAmount(amountNumber, fees, estimatedOperation) : null;
  const estimatedFeeConfig = estimatedOperation === 'PIX' ? fees?.pix : fees?.ted;
  const hasFeeEstimate = fees !== null;
  const feeMayUseMonthlyFreeQuota = Boolean(
    fees?.monthlyTransfersWithoutFee &&
      fees.monthlyTransfersWithoutFee > 0 &&
      estimatedFeeConfig?.consideredInMonthlyTransfersWithoutFee,
  );
  const requiresBirthDate = useMemo(
    () =>
      form.type === 'BANK_ACCOUNT' &&
      requiresOwnerBirthDate(transferContext?.tenantDocumentNormalized, form.cpfCnpj),
    [form.cpfCnpj, form.type, transferContext?.tenantDocumentNormalized],
  );
  const isNewPixKey = useMemo(
    () =>
      form.type === 'PIX' &&
      recipientId === 'manual' &&
      isPixKeyValid(form.pixAddressKey, effectivePixKeyType),
    [effectivePixKeyType, form.pixAddressKey, form.type, recipientId],
  );

  const canAdvance = useMemo(() => {
    if (step === 1) {
      if (form.type === 'PIX') return canPix;
      return canTed;
    }

    if (step === 2) {
      if (form.type === 'PIX') {
        if (!resolvedPixKey.trim() || !effectivePixKeyType) return false;
        const validKey = effectivePixKeyType === 'PHONE'
          ? isValidPixPhoneKey(resolvedPixKey)
          : isPixKeyValid(resolvedPixKey, effectivePixKeyType);
        return validKey && (recipientId !== 'manual' || pixLookup !== null);
      }

      return Boolean(
        form.bankCode.trim() &&
          form.ownerName.trim() &&
          isValidCpfCnpj(form.cpfCnpj) &&
          form.agency.trim() &&
          form.account.trim() &&
          form.accountDigit.trim() &&
          (!requiresBirthDate || form.ownerBirthDate.trim()),
      );
    }

    if (step === 3) {
      const amount = parseAmountNumber(form.amount) ?? 0;
      const debit = estimateTransferDebitAmount(amount, fees, estimatedOperation);
      return isValidDecimalAmount(form.amount) && debit <= maxAmount;
    }

    if (step === 4) {
      return true;
    }

    return validation.valid && !submitting;
  }, [canPix, canTed, effectivePixKeyType, estimatedOperation, fees, form, maxAmount, pixLookup, recipientId, requiresBirthDate, resolvedPixKey, step, submitting, validation.valid]);

  const nextLabel = useMemo(() => {
    if (step !== 5) return 'Próxima etapa';
    return submitting ? 'Processando...' : 'Solicitar transferência';
  }, [step, submitting]);

  function resetPasswordDialog() {
    setPasswordDialogOpen(false);
    setCurrentPassword('');
    setCurrentPasswordError(null);
  }

  function handlePasswordDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      if (submitting) return;
      resetPasswordDialog();
      return;
    }

    setPasswordDialogOpen(true);
  }

  function handleRecipientSelection(value: string) {
    if (recipientId === value) {
      setRecipientId('manual');
      setForm((current) => ({
        ...TRANSFER_INITIAL_STATE,
        type: current.type,
        amount: current.amount,
        description: current.description,
        scheduleDate: current.scheduleDate,
      }));
      return;
    }

    setRecipientId(value);

    if (value === 'manual') {
      setForm((current) => ({
        ...TRANSFER_INITIAL_STATE,
        type: current.type,
        amount: current.amount,
        description: current.description,
        scheduleDate: current.scheduleDate,
      }));
      return;
    }

    const recipient = recipients.find((item) => item.id === value);
    if (!recipient) return;

    setSavePixKey(false);

    setForm((current) => applySelectedRecipientToForm(recipient, current));
  }

  function handleTypeChange(value: TransferDestinationType) {
    setRecipientSearch('');
    setForm((current) => ({
      ...TRANSFER_INITIAL_STATE,
      type: value,
      amount: current.amount,
      description: current.description,
      scheduleDate: current.scheduleDate,
    }));
    setRecipientId('manual');
    setPixLookup(null);
    setPixLookupError(null);

  }

  async function handlePixLookup() {
    if (pixLookupLoading || form.type !== 'PIX' || !effectivePixKeyType) return;
    const normalizedDestination = normalizeWithdrawDestinationForAsaas({
      type: 'PIX',
      pixAddressKey: form.pixAddressKey,
      pixAddressKeyType: effectivePixKeyType,
    });
    if (normalizedDestination.type !== 'PIX') return;
    const key = normalizedDestination.pixAddressKey;
    const valid = effectivePixKeyType === 'PHONE'
      ? isValidPixPhoneKey(key)
      : isPixKeyValid(key, effectivePixKeyType);
    if (!valid) {
      setPixLookup(null);
      setPixLookupError('Informe uma chave Pix válida antes de buscar o titular.');
      return;
    }

    setPixLookupLoading(true);
    setPixLookupError(null);
    try {
      const result = await readJson<PixLookupResult>('/api/finance/transfers/pix-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: effectivePixKeyType, key }),
      });
      setPixLookup(result);
    } catch (error) {
      setPixLookup(null);
      setPixLookupError(mapTransferErrorMessage(sanitizeErrorMessage(error)));
    } finally {
      setPixLookupLoading(false);
    }
  }

  async function handleDeleteRecipient(recipient: TransferRecipient) {
    if (recipient.type !== 'PIX') return;

    setDeletingRecipientId(recipient.id);
    try {
      await readJson('/api/finance/transfers/recipients', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ recipientId: recipient.id }),
      });

      if (recipientId === recipient.id) {
        handleRecipientSelection('manual');
      }

      await onRecipientsChange();

      pushToast({
        title: 'Chave Pix removida',
        description: 'A chave foi retirada da lista salva sem apagar o histórico financeiro.',
        variant: 'success',
      });
    } catch (error) {
      pushToast({
        title: 'Não foi possível remover a chave Pix',
        description: sanitizeErrorMessage(error),
        variant: 'error',
      });
    } finally {
      setDeletingRecipientId(null);
    }
  }

  function handleOpenPasswordDialog() {
    if (form.type === 'PIX' && !effectivePixKeyType) {
      pushToast({
        title: 'Revise a chave Pix',
        description: 'Não foi possível reconhecer a chave informada.',
        variant: 'error',
      });
      return;
    }

    if (!validation.valid) {
      pushToast({
        title: 'Revise os dados da transferência',
        description: validation.errors[0],
        variant: 'error',
      });
      return;
    }

    setCurrentPassword('');
    setCurrentPasswordError(null);
    setPasswordDialogOpen(true);
  }

  async function handleSubmit(password: string) {
    if (submitting) return;

    setSubmitting(true);
    try {
      const payload =
        form.type === 'PIX'
          ? buildTransferPayload({ ...form, pixAddressKey: resolvedPixKey }, effectivePixKeyType as PixKeyType)
          : buildTransferPayload(form, 'EVP');

      await readJson('/api/finance/transfers/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(
          form.type === 'PIX'
            ? {
                ...payload,
                currentPassword: password,
                destination: {
                  ...payload.destination,
                  saveRecipient: savePixKey,
                },
              }
            : {
                ...payload,
                currentPassword: password,
              },
        ),
      });

      pushToast({
        title: 'Transferência solicitada',
        description: 'A saída foi registrada e será acompanhada pela Alusa até a confirmação final.',
        variant: 'success',
      });

      resetPasswordDialog();
      onOpenChange(false);
      setIdempotencyKey(makeIdempotencyKey());
      await onSuccess();
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      if (message === 'SENHA_INVALIDA') {
        setCurrentPasswordError('Senha incorreta. Confira e tente novamente.');
        return;
      }

      resetPasswordDialog();
      pushToast({
        title: 'Não foi possível solicitar a transferência',
        description: mapTransferErrorMessage(message),
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordConfirm() {
    if (submitting) return;

    if (!currentPassword.trim()) {
      setCurrentPasswordError('Informe sua senha para confirmar a transferência.');
      return;
    }

    setCurrentPasswordError(null);
    await handleSubmit(currentPassword);
  }

  async function handleNext() {
    if (!canAdvance) return;

    if (step === 5) {
      handleOpenPasswordDialog();
      return;
    }

    setStep((current) => Math.min(current + 1, 5));
  }

  function handleBack() {
    if (step === 1) {
      onOpenChange(false);
      return;
    }

    setStep((current) => Math.max(current - 1, 1));
  }

  return (
    <>
      <WizardDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Nova transferência"
      description="Organize a saída em etapas, revise os dados e confirme com mais segurança."
      step={step}
      totalSteps={5}
      canGoBack={true}
      canProceed={canAdvance}
      nextLabel={nextLabel}
      onBack={handleBack}
      onNext={() => void handleNext()}
      loading={submitting}
      nextTestId="wizard-next"
      >
      {step === 1 ? (
        <WizardSection title="Escolha como deseja transferir" hint="Cada opção abre apenas os campos necessários para este envio.">
          <div className="grid gap-3 md:grid-cols-2">
            <ChoiceCard
              selected={form.type === 'PIX'}
              disabled={!canPix}
              title="Pix por chave"
              description="Mais rápido para chaves CPF, CNPJ, e-mail, telefone ou aleatória."
              onClick={() => handleTypeChange('PIX')}
            />
            <ChoiceCard
              selected={form.type === 'BANK_ACCOUNT'}
              disabled={!canTed}
              title="Transferência bancária"
              description="Informe banco, agência e conta. A transferência será processada conforme a instituição de destino."
              onClick={() => handleTypeChange('BANK_ACCOUNT')}
            />
          </div>
        </WizardSection>
      ) : null}

      {step === 2 ? (
        form.type === 'PIX' ? (
          <>
            <WizardSection title="Destinatário">
              <div className="space-y-5">
                {/* Chave Pix */}
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-pix-key" className="text-xs font-medium text-slate-600">
                    Chave Pix
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="transfer-pix-key"
                      value={form.pixAddressKey}
                      onChange={(event) => {
                        const value = formatPixKeyInput(event.target.value);
                        setRecipientId('manual');
                        setPixLookup(null);
                        setPixLookupError(null);
                        setForm((current) => ({
                          ...current,
                          pixAddressKey: value,
                          pixAddressKeyType: detectPixKeyType(value) ?? current.pixAddressKeyType,
                        }));
                      }}
                      placeholder={selectedPixRecipient ? 'Chave salva selecionada. Digite para informar outra chave.' : 'CPF, CNPJ, e-mail, celular ou chave aleatória'}
                      aria-label="Chave Pix"
                      className={WIZARD_CONTROL_CLASS}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className={`${WIZARD_CONTROL_CLASS} shrink-0`}
                      disabled={pixLookupLoading || !effectivePixKeyType || (effectivePixKeyType === 'PHONE' ? !isValidPixPhoneKey(form.pixAddressKey) : !isPixKeyValid(form.pixAddressKey, effectivePixKeyType))}
                      onClick={() => void handlePixLookup()}
                    >
                      <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                      {pixLookupLoading ? 'Buscando...' : 'Buscar'}
                    </Button>
                  </div>
                  {selectedPixRecipient ? (
                    <p className="text-xs text-primary">
                      Chave salva selecionada. Clique nela novamente para desmarcar ou digite outra chave manualmente.
                    </p>
                  ) : null}
                  {detectedPixKeyType && isPixKeyValid(form.pixAddressKey, detectedPixKeyType) ? (
                    <p className="text-xs text-slate-500">
                      Chave reconhecida como <span className="font-medium text-slate-700">{formatPixKeyType(detectedPixKeyType)}</span>. Confira com o destinatário.
                    </p>
                  ) : null}
                </div>

                {pixLookupError ? (
                  <InfoCallout variant="warning" size="sm" title="Não foi possível consultar a chave">
                    {pixLookupError}
                  </InfoCallout>
                ) : null}

                {pixLookup ? (
                  <InfoCallout variant="info" size="sm" title="Titular encontrado">
                    {pixLookup.ownerName ? <InfoCalloutItem label="Nome">{pixLookup.ownerName}</InfoCalloutItem> : null}
                    {pixLookup.ownerDocumentMasked ? <InfoCalloutItem label="CPF/CNPJ">{pixLookup.ownerDocumentMasked}</InfoCalloutItem> : null}
                    {pixLookup.institutionName ? <InfoCalloutItem label="Instituição">{pixLookup.institutionName}</InfoCalloutItem> : null}
                    {pixLookup.bankName ? <InfoCalloutItem label="Banco">{pixLookup.bankName}{pixLookup.bankCode ? ` (${pixLookup.bankCode})` : ''}</InfoCalloutItem> : null}
                  </InfoCallout>
                ) : null}

                {/* Separador */}
                {(recipients.some((r) => r.type === 'PIX') || filteredRecipients.length > 0) ? (
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">ou escolha recente</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                ) : null}

                {/* Busca + lista de recentes */}
                {recipients.some((r) => r.type === 'PIX') || filteredRecipients.length > 0 ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <Input
                        id="transfer-recipient-search"
                        value={recipientSearch}
                        onChange={(event) => setRecipientSearch(event.target.value)}
                        placeholder="Buscar por nome ou chave"
                        className={`${WIZARD_CONTROL_CLASS} bg-slate-50 pl-9`}
                      />
                    </div>

                    {filteredRecipients.length > 0 ? (
                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-primary/30 scrollbar-track-transparent">
                        {filteredRecipients.map((recipient) => {
                          const isSelected = recipient.id === recipientId;
                          return (
                            <RecipientCard
                              key={recipient.id}
                              recipient={recipient}
                              selected={isSelected}
                              deleting={deletingRecipientId === recipient.id}
                              canDelete={recipient.type === 'PIX'}
                              onSelect={() => handleRecipientSelection(recipient.id)}
                              onDelete={() => void handleDeleteRecipient(recipient)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">
                        Nenhuma conta encontrada.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </WizardSection>
          </>
        ) : (
          <>
            {recipients.some((r) => r.type === 'BANK_ACCOUNT') ? (
            <WizardSection title="Destinatários recentes">
              <div className="space-y-5">
                {/* Lista de recentes */}
                <>
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <Input
                        value={recipientSearch}
                        onChange={(event) => setRecipientSearch(event.target.value)}
                        placeholder="Buscar por nome ou banco"
                        className={`${WIZARD_CONTROL_CLASS} bg-slate-50 pl-9`}
                      />
                    </div>
                    {filteredRecipients.length > 0 ? (
                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-primary/30 scrollbar-track-transparent">
                        {filteredRecipients.map((recipient) => {
                          const isSelected = recipient.id === recipientId;
                          return (
                            <RecipientCard
                              key={recipient.id}
                              recipient={recipient}
                              selected={isSelected}
                              deleting={deletingRecipientId === recipient.id}
                              onSelect={() => handleRecipientSelection(recipient.id)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">
                        Nenhuma conta encontrada.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">ou preencha manualmente</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                </>
              </div>
            </WizardSection>
            ) : null}

            <WizardSection title="Informe os dados bancários" hint="Preencha os dados do titular e da conta que vai receber.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Código do banco</Label>
                  <Input
                    value={form.bankCode}
                    onChange={(event) => setForm((current) => ({ ...current, bankCode: event.target.value }))}
                    placeholder="001"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Nome do titular</Label>
                  <Input
                    value={form.ownerName}
                    onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))}
                    placeholder="Nome completo"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">CPF ou CNPJ</Label>
                  <Input
                    value={form.cpfCnpj}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, cpfCnpj: formatCpfCnpjBR(normalizeDigits(event.target.value)) }))
                    }
                    placeholder="Somente números ou documento formatado"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                {requiresBirthDate ? (
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs font-medium text-slate-600">Data de nascimento do titular</Label>
                    <Input
                      type="date"
                      value={form.ownerBirthDate}
                      onChange={(event) => setForm((current) => ({ ...current, ownerBirthDate: event.target.value }))}
                      className={WIZARD_CONTROL_CLASS}
                    />
                    <p className="text-xs text-slate-500">
                      Necessário quando o favorecido é pessoa física com CPF diferente da conta financeira.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Agência</Label>
                  <Input
                    value={form.agency}
                    onChange={(event) => setForm((current) => ({ ...current, agency: event.target.value }))}
                    placeholder="0001"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Conta</Label>
                  <Input
                    value={form.account}
                    onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                    placeholder="12345"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Dígito</Label>
                  <Input
                    value={form.accountDigit}
                    onChange={(event) => setForm((current) => ({ ...current, accountDigit: event.target.value }))}
                    placeholder="6"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Tipo da conta</Label>
                  <Select
                    value={form.bankAccountType}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, bankAccountType: value as BankAccountType }))
                    }
                  >
                    <SelectTrigger className={WIZARD_CONTROL_CLASS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONTA_CORRENTE">Conta corrente</SelectItem>
                      <SelectItem value="CONTA_POUPANCA">Conta poupança</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600">Descrição da conta</Label>
                  <Input
                    value={form.accountName}
                    onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))}
                    placeholder="Opcional"
                    className={WIZARD_CONTROL_CLASS}
                  />
                </div>
              </div>
            </WizardSection>
          </>
        )
      ) : null}

      {step === 3 ? (
        <WizardSection title="Valor da transferência" hint="Defina quanto será enviado nesta saída.">
          <div className="flex flex-col items-center justify-center py-10 md:py-14">
            <Label htmlFor="transfer-amount" className="sr-only">
              Valor
            </Label>

            <div className="flex w-full items-center justify-center gap-2">
              <span className="text-2xl font-medium tracking-tight text-slate-800 md:text-3xl">
                R$
              </span>
              <Input
                id="transfer-amount"
                value={form.amount}
                onChange={(event) => {
                  setForm((current) => ({ ...current, amount: formatCurrencyInput(event.target.value) }));
                }}
                placeholder="0,00"
                inputMode="numeric"
                className="h-auto border-0 bg-transparent p-0 text-left text-5xl font-semibold tracking-tight text-slate-950 shadow-none outline-none ring-0 placeholder:text-slate-300 focus-visible:ring-0 md:text-6xl"
                style={{ width: `calc(${Math.max((form.amount || '0,00').length, 4)}ch + 10px)` }}
              />
            </div>

            <p className="mt-4 text-center text-sm text-slate-500">
              Saldo disponível {formatCurrency(maxAmount)}
            </p>
            <p className="mt-2 text-center text-xs text-slate-400">
              Digite os centavos ou use vírgula. Exemplo: 10,00.
            </p>
          </div>
        </WizardSection>
      ) : null}

      {step === 4 ? (
        <WizardSection title="Agendamento" hint="Escolha a data da transferência e adicione uma descrição interna se quiser.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-600">Agendar para</Label>
              <Input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={form.scheduleDate}
                onChange={(event) => {
                  setForm((current) => ({ ...current, scheduleDate: event.target.value }));
                }}
                className={WIZARD_CONTROL_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-600">Descrição operacional</Label>
              <Input
                value={form.description}
                onChange={(event) => {
                  setForm((current) => ({ ...current, description: event.target.value }));
                }}
                placeholder="Opcional"
                className={WIZARD_CONTROL_CLASS}
              />
            </div>
          </div>
        </WizardSection>
      ) : null}

      {step === 5 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Destino</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {form.type === 'PIX'
                    ? (effectivePixKeyType ? `Chave Pix (${formatPixKeyType(effectivePixKeyType)})` : 'Chave Pix')
                    : `${form.ownerName || 'Transferência bancária'}`}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {form.type === 'PIX'
                    ? (selectedPixRecipient
                      ? selectedPixRecipient.detail
                      : effectivePixKeyType
                        ? formatPixKeyForDisplay(form.pixAddressKey, effectivePixKeyType)
                        : form.pixAddressKey)
                    : `Banco ${form.bankCode} • Ag ${form.agency} • Cc ${form.account}-${form.accountDigit}`}
                </p>
                {form.description ? (
                  <p className="mt-1 text-xs text-slate-400">{form.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {form.type === 'PIX' ? 'Pix' : 'Bancária'}
              </span>
            </div>

            <div>
              <SummaryRow
                label="Valor enviado"
                value={amountNumber != null ? formatCurrency(amountNumber) : '—'}
              />
              {hasFeeEstimate ? (
                <SummaryRow
                  label={feeMayUseMonthlyFreeQuota ? 'Taxa de referência' : 'Taxa estimada'}
                  value={formatCurrency(estimatedFee)}
                />
              ) : null}
              {estimatedDebit != null ? (
                <SummaryRow label="Total estimado" value={formatCurrency(estimatedDebit)} />
              ) : null}
              {hasFeeEstimate ? (
                <p className="pt-2 text-xs leading-relaxed text-slate-500">
                  {feeMayUseMonthlyFreeQuota
                    ? 'A taxa de referência vem das tarifas atuais da conta. A transferência pode ser gratuita se houver cota mensal disponível. Após o processamento, a Alusa confirmará a taxa e o valor efetivamente debitado.'
                    : 'A taxa é uma estimativa antes do envio. Após o processamento, a Alusa confirmará a taxa e o valor efetivamente debitado.'}
                </p>
              ) : null}
              {form.scheduleDate ? (
                <SummaryRow label="Agendamento" value={formatDateForDisplay(form.scheduleDate)} />
              ) : null}
            </div>

            {isNewPixKey ? (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setSavePixKey((prev) => !prev)}
                  aria-pressed={savePixKey}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                    savePixKey
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-white',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all',
                      savePixKey
                        ? 'border-primary bg-primary'
                        : 'border-slate-300 bg-white',
                    )}
                  >
                    {savePixKey ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-white">
                        <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={cn('text-sm font-medium', savePixKey ? 'text-primary' : 'text-slate-700')}>
                    Salvar esta chave Pix para reutilizar depois
                  </span>
                </button>
                <p className="text-[11px] text-slate-400">
                  Quando os dados oficiais do titular forem confirmados, a chave Pix será salva automaticamente com nome, documento e banco.
                </p>
              </div>
            ) : null}

            {!validation.valid ? (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 shrink-0">
                  <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 1 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
                {validation.errors[0]}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      </WizardDialogFrame>

      <Dialog open={passwordDialogOpen} onOpenChange={handlePasswordDialogOpenChange}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Confirmar com senha</DialogTitle>
            <DialogDescription>
              Digite sua senha atual para confirmar e concluir esta transferência com segurança.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handlePasswordConfirm();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="transfer-current-password">Senha atual</Label>
              <Input
                id="transfer-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  if (currentPasswordError) setCurrentPasswordError(null);
                }}
                disabled={submitting}
                className={WIZARD_CONTROL_CLASS}
              />
              {currentPasswordError ? <p className="text-xs text-destructive">{currentPasswordError}</p> : null}
            </div>

            <DialogFooter className="gap-2 pt-2 sm:justify-end">
              <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={() => handlePasswordDialogOpenChange(false)} disabled={submitting}>
                Voltar
              </Button>
              <Button type="submit" className="h-10 rounded-lg" disabled={submitting} data-testid="confirm-transfer-password">
                {submitting ? 'Validando...' : 'Confirmar e solicitar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
