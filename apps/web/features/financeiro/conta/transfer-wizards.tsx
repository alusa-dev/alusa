'use client';

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { GetAccountOverviewOutput } from '@alusa/finance';

import { formatCurrency } from '../extrato/utils/extrato-formatters';
import { formatDate } from '../extrato/utils/extrato-formatters';

export type TransferDestinationType = 'PIX' | 'BANK_ACCOUNT';
export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
export type BankAccountType = 'CONTA_CORRENTE' | 'CONTA_POUPANCA';

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
    case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
      return 'A conta financeira ainda não está configurada para movimentação.';
    case 'IDEMPOTENCY_KEY_OBRIGATORIO':
      return 'A solicitação não pode ser protegida contra duplicidade. Tente novamente.';
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
  const normalized = value.trim();
  const digits = normalizeDigits(value);
  if (normalized.startsWith('+')) return digits.length >= 12 && digits.length <= 13;
  return digits.length >= 10 && digits.length <= 13 && !isValidCpf(digits) && !isValidCnpj(digits);
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
      return 'Aleatoria';
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

function buildTransferValidation(form: TransferFormState, maxAmount: number, pixKeyType: PixKeyType | null) {
  const errors: string[] = [];
  const amountIsValid = isValidDecimalAmount(form.amount);
  const amountValue = parseAmountNumber(form.amount);

  if (!amountIsValid) {
    errors.push('Informe um valor valido.');
  } else if ((amountValue ?? 0) > maxAmount) {
    errors.push('O valor informado excede o saldo disponível.');
  }

  if (form.type === 'PIX') {
    if (!form.pixAddressKey.trim()) {
      errors.push('Informe a chave Pix do destinatário.');
    } else if (!pixKeyType) {
      errors.push('Não foi possível reconhecer a chave Pix informada.');
    } else if (!isPixKeyValid(form.pixAddressKey, pixKeyType)) {
      errors.push(`A chave Pix não corresponde ao tipo ${formatPixKeyType(pixKeyType)}.`);
    }
  }

  if (form.type === 'BANK_ACCOUNT') {
    if (!form.bankCode.trim()) errors.push('Informe o codigo do banco.');
    if (!form.ownerName.trim()) errors.push('Informe o nome do titular.');
    if (!isValidCpfCnpj(form.cpfCnpj)) errors.push('Informe um CPF ou CNPJ valido do titular.');
    if (!form.agency.trim()) errors.push('Informe a agencia.');
    if (!form.account.trim()) errors.push('Informe a conta.');
    if (!form.accountDigit.trim()) errors.push('Informe o digito da conta.');
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


function buildTransferPayload(form: TransferFormState, pixKeyType: PixKeyType) {
  if (form.type === 'PIX') {
    return {
      amount: toApiAmountString(form.amount),
      description: form.description || undefined,
      scheduleDate: form.scheduleDate || undefined,
      destination: {
        type: 'PIX' as const,
        pixAddressKey: form.pixAddressKey.trim(),
        pixAddressKeyType: pixKeyType,
        saveRecipient: false,
      },
    };
  }

  return {
    amount: toApiAmountString(form.amount),
    description: form.description || undefined,
    scheduleDate: form.scheduleDate || undefined,
    destination: {
      type: 'BANK_ACCOUNT' as const,
      bank: { code: form.bankCode.trim() },
      accountName: form.accountName || undefined,
      ownerName: form.ownerName.trim(),
      ownerBirthDate: form.ownerBirthDate || undefined,
      cpfCnpj: form.cpfCnpj.trim(),
      agency: form.agency.trim(),
      account: form.account.trim(),
      accountDigit: form.accountDigit.trim() || undefined,
      bankAccountType: form.bankAccountType || undefined,
      ispb: form.ispb || undefined,
    },
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
      <DialogContent className="w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-50 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative rounded-t-2xl border-b border-slate-200 bg-slate-50 p-4 md:p-6">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
              <Progress
                value={(step / totalSteps) * 100}
                className="h-2 bg-transparent [&>div]:bg-gradient-to-r [&>div]:from-brand-accent [&>div]:to-brand-accent/70"
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

        <div className="flex max-h-[78vh] flex-col">
          <div
            className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
            style={{ scrollbarWidth: 'thin', scrollbarGutter: 'stable', scrollbarColor: '#d1d5db transparent' }}
          >
            <div className="mx-auto w-full max-w-4xl space-y-6">{children}</div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-4 md:p-6">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={!canGoBack || loading}
              className="h-10 min-w-[140px] border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100"
            >
              Voltar
            </Button>
            <Button
              type="button"
              className="h-10 min-w-[180px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
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
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </div>
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
        'rounded-2xl border p-4 text-left transition',
        selected
          ? 'border-brand-accent bg-brand-accent/5 ring-2 ring-brand-accent/20'
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
        'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all',
        selected
          ? 'border-brand-primary/40 bg-brand-primary/5 shadow-sm'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
      )}
    >
      <span className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        selected ? 'bg-brand-accent text-white' : 'bg-brand-accent/10 text-brand-accent',
      )}>
        {initials || 'PX'}
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-semibold', selected ? 'text-brand-primary' : 'text-slate-900')}>
          {getRecipientPrimaryLine(recipient)}
        </span>
        <span className={cn('mt-0.5 block truncate text-xs', selected ? 'text-brand-primary/75' : 'text-slate-500')}>
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
              'inline-flex h-9 w-9 items-center justify-center rounded-full border border-brand-accent/20 bg-white text-brand-accent transition',
              deleting ? 'cursor-wait opacity-60' : 'hover:border-brand-accent/40 hover:bg-brand-accent/10 hover:text-brand-accent',
            )}
          >
            <Trash2 className="h-4 w-4" />
          </span>
        ) : null}
        {selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent text-white">
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

  useEffect(() => {
    if (!open) {
      setStep(1);
      setRecipientId('manual');
      setRecipientSearch('');
      setSavePixKey(false);
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
    selectedPixDestination?.pixAddressKeyType ?? detectedPixKeyType ?? (form.pixAddressKeyType ?? null);
  const validation = useMemo(
    () => buildTransferValidation({ ...form, pixAddressKey: resolvedPixKey }, maxAmount, effectivePixKeyType),
    [effectivePixKeyType, form, maxAmount, resolvedPixKey],
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
        return Boolean(resolvedPixKey.trim()) && isPixKeyValid(resolvedPixKey, effectivePixKeyType);
      }

      return Boolean(
            form.bankCode.trim() &&
              form.ownerName.trim() &&
              isValidCpfCnpj(form.cpfCnpj) &&
              form.agency.trim() &&
              form.account.trim() &&
              form.accountDigit.trim(),
          );
    }

    if (step === 3) {
      return isValidDecimalAmount(form.amount) && (parseAmountNumber(form.amount) ?? 0) <= maxAmount;
    }

    if (step === 4) {
      return true;
    }

    return validation.valid && !submitting;
  }, [canPix, canTed, effectivePixKeyType, form, maxAmount, step, submitting, validation.valid]);

  const nextLabel = useMemo(() => {
    if (step !== 5) return 'Próxima etapa';
    return submitting ? 'Processando...' : 'Solicitar transferência';
  }, [step, submitting]);

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

  async function handleSubmit() {
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
          'Idempotency-Key': makeIdempotencyKey(),
        },
        body: JSON.stringify(
          form.type === 'PIX'
            ? {
                ...payload,
                destination: {
                  ...payload.destination,
                  saveRecipient: savePixKey,
                },
              }
            : payload,
        ),
      });

      pushToast({
        title: 'Transferência solicitada',
        description: 'A saída foi registrada e será acompanhada pela Alusa até a confirmação final.',
        variant: 'success',
      });

      onOpenChange(false);
      await onSuccess();
    } catch (error) {
      pushToast({
        title: 'Não foi possível solicitar a transferência',
        description: mapTransferErrorMessage(sanitizeErrorMessage(error)),
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (!canAdvance) return;

    if (step === 5) {
      await handleSubmit();
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
        <WizardSection title="Escolha como deseja transferir" hint="Cada opcao abre apenas os campos necessarios para esse envio.">
          <div className="grid gap-3 md:grid-cols-2">
            <ChoiceCard
              selected={form.type === 'PIX'}
              disabled={!canPix}
              title="Pix por chave"
              description="Mais rapido para chaves CPF, CNPJ, e-mail, telefone ou aleatoria."
              onClick={() => handleTypeChange('PIX')}
            />
            <ChoiceCard
              selected={form.type === 'BANK_ACCOUNT'}
              disabled={!canTed}
              title="TED bancária"
              description="Use quando precisar informar banco, agencia e conta do favorecido."
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
                  <Label htmlFor="transfer-pix-key" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Chave Pix
                  </Label>
                  <Input
                    id="transfer-pix-key"
                    value={form.pixAddressKey}
                    onChange={(event) => {
                      const value = formatPixKeyInput(event.target.value);
                      setRecipientId('manual');
                      setForm((current) => ({
                        ...current,
                        pixAddressKey: value,
                        pixAddressKeyType: detectPixKeyType(value) ?? current.pixAddressKeyType,
                      }));
                    }}
                    placeholder={selectedPixRecipient ? 'Chave salva selecionada. Digite para informar outra chave.' : 'CPF, CNPJ, e-mail, telefone ou chave aleatoria'}
                    aria-label="Chave Pix"
                    className="h-11"
                  />
                  {selectedPixRecipient ? (
                    <p className="text-xs text-brand-accent">
                      Chave salva selecionada. Clique nela novamente para desmarcar ou digite outra chave manualmente.
                    </p>
                  ) : null}
                  {detectedPixKeyType && isPixKeyValid(form.pixAddressKey, detectedPixKeyType) ? (
                    <p className="text-xs text-slate-500">
                      Chave reconhecida como <span className="font-medium text-slate-700">{detectedPixKeyType}</span>. Confira com o destinatário.
                    </p>
                  ) : null}
                </div>

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
                    <Input
                      id="transfer-recipient-search"
                      value={recipientSearch}
                      onChange={(event) => setRecipientSearch(event.target.value)}
                      placeholder="Buscar por nome ou chave"
                      className="h-9 bg-slate-50 text-sm"
                    />

                    {filteredRecipients.length > 0 ? (
                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-brand-accent/30 scrollbar-track-transparent">
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
                    <Input
                      value={recipientSearch}
                      onChange={(event) => setRecipientSearch(event.target.value)}
                      placeholder="Buscar por nome ou banco"
                      className="h-9 bg-slate-50 text-sm"
                    />
                    {filteredRecipients.length > 0 ? (
                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-brand-accent/30 scrollbar-track-transparent">
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

            <WizardSection title="Informe os dados bancarios" hint="Preencha os dados do titular e da conta que vai receber.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Codigo do banco</Label>
                  <Input
                    value={form.bankCode}
                    onChange={(event) => setForm((current) => ({ ...current, bankCode: event.target.value }))}
                    placeholder="001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nome do titular</Label>
                  <Input
                    value={form.ownerName}
                    onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CPF ou CNPJ</Label>
                  <Input
                    value={form.cpfCnpj}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, cpfCnpj: formatCpfCnpjBR(normalizeDigits(event.target.value)) }))
                    }
                    placeholder="Somente numeros ou documento formatado"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Agencia</Label>
                  <Input
                    value={form.agency}
                    onChange={(event) => setForm((current) => ({ ...current, agency: event.target.value }))}
                    placeholder="0001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Conta</Label>
                  <Input
                    value={form.account}
                    onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                    placeholder="12345"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Digito</Label>
                  <Input
                    value={form.accountDigit}
                    onChange={(event) => setForm((current) => ({ ...current, accountDigit: event.target.value }))}
                    placeholder="6"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo da conta</Label>
                  <Select
                    value={form.bankAccountType}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, bankAccountType: value as BankAccountType }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONTA_CORRENTE">Conta corrente</SelectItem>
                      <SelectItem value="CONTA_POUPANCA">Conta poupanca</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Descrição da conta</Label>
                  <Input
                    value={form.accountName}
                    onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))}
                    placeholder="Opcional"
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
          </div>
        </WizardSection>
      ) : null}

      {step === 4 ? (
        <WizardSection title="Agendamento" hint="Escolha a data da transferência e adicione uma descrição interna se quiser.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Agendar para</Label>
              <Input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={form.scheduleDate}
                onChange={(event) => {
                  setForm((current) => ({ ...current, scheduleDate: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição operacional</Label>
              <Input
                value={form.description}
                onChange={(event) => {
                  setForm((current) => ({ ...current, description: event.target.value }));
                }}
                placeholder="Opcional"
              />
            </div>
          </div>
        </WizardSection>
      ) : null}

      {step === 5 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Destino</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {form.type === 'PIX'
                    ? (effectivePixKeyType ? `Chave Pix (${formatPixKeyType(effectivePixKeyType)})` : 'Chave Pix')
                    : `${form.ownerName || 'TED bancária'}`}
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
                {form.type === 'PIX' ? 'Pix' : 'TED'}
              </span>
            </div>

            <div>
              <SummaryRow
                label="Valor enviado"
                value={amountNumber != null ? formatCurrency(amountNumber) : '—'}
              />
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
                      ? 'border-brand-primary/40 bg-brand-primary/5'
                      : 'border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-white',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all',
                      savePixKey
                        ? 'border-brand-primary bg-brand-primary'
                        : 'border-slate-300 bg-white',
                    )}
                  >
                    {savePixKey ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-white">
                        <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={cn('text-sm font-medium', savePixKey ? 'text-brand-primary' : 'text-slate-700')}>
                    Salvar esta chave Pix para reutilizar depois
                  </span>
                </button>
                <p className="text-[11px] text-slate-400">
                  Quando o Asaas retornar os dados oficiais do titular, a chave Pix será salva automaticamente com nome, documento e banco.
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
        </div>
      ) : null}
    </WizardDialogFrame>
  );
}
