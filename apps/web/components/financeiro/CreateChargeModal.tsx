'use client';

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Command as CommandPrimitive } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { pushToast } from '@/components/ui/toast';
import { ChevronLeft, ChevronRight, CheckCircle, Refresh, Search } from '@/components/icons/icons';
import { cn } from '@/lib/utils';
import { maskCPF } from '@/lib/utils/masks';
import { StepHeader, SectionCard, FieldLabel } from '@/components/alunos/wizard/ui';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';
import { asaasNotificationPreferencesResultDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { type CustomerNotificationChannel } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';

// =============================================================================
// Types & Schema
// =============================================================================

const chargeSchema = z.object({
  // Step 1: Pagador
  payerType: z.enum(['aluno', 'responsavel']),
  payerId: z.string().min(1, 'Selecione um pagador'),
  payerName: z.string().optional(),

  // Step 2: Dados da cobrança
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT', 'SUBSCRIPTION']),
  value: z.number().positive('Valor deve ser maior que zero').optional(),
  installmentCount: z.number().int().min(2).max(24).optional(),
  installmentValue: z.number().positive().optional(),
  dueDate: z.string().optional(),
  nextDueDate: z.string().optional(),
  endDate: z.string().optional(),
  cycle: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']).optional(),
  description: z.string().max(500).optional(),

  // Step 3: Forma de pagamento
  billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),

  // Step 4: Regras (opcional)
  discountValue: z.number().min(0).optional(),
  discountType: z.enum(['FIXED', 'PERCENTAGE']).optional(),
  discountDueDateLimitDays: z.number().int().min(0).optional(),
  interestValue: z.number().min(0).optional(),
  fineValue: z.number().min(0).optional(),
  fineType: z.enum(['FIXED', 'PERCENTAGE']).optional(),
});

type ChargeFormData = z.infer<typeof chargeSchema>;

type PayerSearchResult = FinancePayerCandidateDTO;

// =============================================================================
// Component
// =============================================================================

interface CreateChargeModalProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: () => void;
  /** Pré-seleciona o tipo de cobrança no step 2. */
  defaultChargeType?: 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';
}

const CHARGE_TYPE_LABELS = {
  ONE_TIME: { title: 'Gerar nova cobrança', toast: 'Cobrança gerada', subtitle: 'Preencha os dados da cobrança em etapas.' },
  INSTALLMENT: { title: 'Novo parcelamento', toast: 'Parcelamento criado', subtitle: 'Preencha os dados do parcelamento em etapas.' },
  SUBSCRIPTION: { title: 'Nova assinatura', toast: 'Assinatura criada', subtitle: 'Preencha os dados da assinatura em etapas.' },
} as const;

const PAYMENT_OPTIONS_BY_CHARGE_TYPE = {
  ONE_TIME: [
    { value: 'PIX', label: 'Pix', icon: '📱' },
    { value: 'BOLETO', label: 'Boleto', icon: '📄' },
    { value: 'CREDIT_CARD', label: 'Cartão de Crédito', icon: '💳' },
    { value: 'UNDEFINED', label: 'Cliente escolhe', icon: '🔄' },
  ],
  INSTALLMENT: [
    { value: 'BOLETO', label: 'Boleto', icon: '📄' },
    { value: 'CREDIT_CARD', label: 'Cartão de Crédito', icon: '💳' },
  ],
  SUBSCRIPTION: [
    { value: 'PIX', label: 'Pix', icon: '📱' },
    { value: 'BOLETO', label: 'Boleto', icon: '📄' },
    { value: 'CREDIT_CARD', label: 'Cartão de Crédito', icon: '💳' },
    { value: 'UNDEFINED', label: 'Cliente escolhe', icon: '🔄' },
  ],
} as const;

export function CreateChargeModal({ open, onOpenChange, onSuccess, defaultChargeType }: CreateChargeModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [installments, setInstallments] = useState(1);
  const [notificationChannels, setNotificationChannels] = useState<CustomerNotificationChannel[]>([]);
  const [notificationChannelsConfigured, setNotificationChannelsConfigured] = useState(false);
  const [loadingNotificationDefaults, setLoadingNotificationDefaults] = useState(false);
  const [notificationDefaultsError, setNotificationDefaultsError] = useState<string | null>(null);

  // Autocomplete State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const [selectedPayer, setSelectedPayer] = useState<PayerSearchResult | null>(null);

  const payerInitials = useMemo(() => {
    if (!selectedPayer?.name) return '';
    return selectedPayer.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }, [selectedPayer?.name]);

  const form = useForm<ChargeFormData>({
    resolver: zodResolver(chargeSchema),
    defaultValues: {
      payerType: 'aluno',
      payerId: '',
      chargeType: defaultChargeType ?? 'ONE_TIME',
      billingType: 'UNDEFINED',
      discountType: 'PERCENTAGE',
      fineType: 'PERCENTAGE',
    },
  });

  const { watch, setValue, handleSubmit, formState: { errors }, reset } = form;
  const chargeType = watch('chargeType');
  const billingType = watch('billingType');
  const isSubscription = chargeType === 'SUBSCRIPTION';
  const value = watch('value') || 0;
  const labels = CHARGE_TYPE_LABELS[chargeType] ?? CHARGE_TYPE_LABELS.ONE_TIME;
  const paymentOptions = useMemo(() => PAYMENT_OPTIONS_BY_CHARGE_TYPE[chargeType], [chargeType]);

  const loadNotificationDefaults = useCallback(async () => {
    try {
      setLoadingNotificationDefaults(true);
      const response = await fetch('/api/configuracoes/notificacoes/asaas', {
        cache: 'no-store',
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(raw?.error || 'Não foi possível carregar a régua de notificações.');
      }

      const parsed = asaasNotificationPreferencesResultDTOSchema.parse(raw);
      setNotificationChannels(parsed.customerChannelDefaults as CustomerNotificationChannel[]);
      setNotificationChannelsConfigured(true);
      setNotificationDefaultsError(null);
    } catch (error) {
      console.warn('[CreateChargeModal] Falha ao carregar defaults de notificação', error);
      setNotificationChannels([]);
      setNotificationChannelsConfigured(false);
      setNotificationDefaultsError(
        'Não foi possível carregar o padrão da conta. Se você continuar sem marcar canais, a configuração atual do cliente será preservada.',
      );
    } finally {
      setLoadingNotificationDefaults(false);
    }
  }, []);

  useEffect(() => {
    if (chargeType === 'INSTALLMENT' && (billingType === 'UNDEFINED' || billingType === 'PIX')) {
      setValue('billingType', 'BOLETO');
    }
  }, [billingType, chargeType, setValue]);

  useEffect(() => {
    if (!open) return;
    void loadNotificationDefaults();
  }, [open, loadNotificationDefaults]);

  // Buscar pagadores (Debounced)
  const searchPayers = useCallback((query: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/finance/payers/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Erro ao buscar');
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  // Effect para buscar quando query muda
  useEffect(() => {
    if (!selectedPayer) {
      searchPayers(searchQuery);
    }
  }, [searchQuery, searchPayers, selectedPayer]);

  const handlePayerSelect = (payer: PayerSearchResult) => {
    setSelectedPayer(payer);
    setSearchQuery(payer.name); // Preenche input com nome
    setSearchOpen(false); // Fecha dropdown

    // Preserva o pagador originalmente escolhido na UI.
    // A resolução para responsável financeiro acontece no backend, sem perder o nome exibido do aluno.
    setValue('payerType', payer.type);
    setValue('payerId', payer.id);
    setValue('payerName', payer.name);
  };

  const handleClose = () => {
    reset({ chargeType: defaultChargeType ?? 'ONE_TIME' });
    setStep(1);
    setSelectedPayer(null);
    setSearchQuery('');
    setSearchResults([]);
    setInstallments(1);
    setNotificationChannels([]);
    setNotificationChannelsConfigured(false);
    setNotificationDefaultsError(null);
    onOpenChange(false);
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, 6));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  function parseCurrencyBRLToCents(input: string) {
    const digits = input.replace(/\D/g, '');
    if (!digits) return null;
    return Number(digits);
  }

  function parseMaskedNumber(input: string): number | undefined {
    if (!input.trim()) return undefined;
    const normalized = input.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  function formatBRLInput(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    const padded = digits.padStart(3, '0');
    let intPart = padded.slice(0, -2);
    const decPart = padded.slice(-2);
    intPart = intPart.replace(/^0+(?!$)/, '');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${intFormatted},${decPart}`;
  }

  function formatPercentInput(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    const padded = digits.padStart(3, '0');
    const intPart = padded.slice(0, -2).replace(/^0+(?!$)/, '');
    const decPart = padded.slice(-2);
    return `${intPart || '0'},${decPart}`;
  }

  function formatDecimalDisplay(value: number | undefined): string {
    if (value == null || Number.isNaN(value)) return '';
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const formatCurrency = (val: number) => currencyFormatter.format(val);

  const baseValue = useMemo(() => {
    if (chargeType === 'INSTALLMENT' && installments > 0) {
      return value / installments;
    }
    return value;
  }, [chargeType, value, installments]);

  const canProceed = (currentStep: number): boolean => {
    switch (currentStep) {
      case 1:
        // Só pode avançar se pagador está selecionado e tem cadastro financeiro completo
        return (
          !!selectedPayer &&
          selectedPayer.financialStatus === 'OK' &&
          (!selectedPayer.isMinor || selectedPayer.hasResponsible)
        );
      case 2: {
        const ct = watch('chargeType');
        if (ct === 'SUBSCRIPTION') {
          return (
            !!watch('value') &&
            watch('value')! > 0 &&
            !!watch('nextDueDate') &&
            !!watch('cycle') &&
            !!watch('endDate')
          );
        }
        return !!watch('value') && watch('value')! > 0 && !!watch('dueDate');
      }
      case 3:
        return !!watch('billingType');
      case 4:
        return true; // Notificações (opcional)
      case 5:
        return true; // Regras (opcional)
      case 6:
        return true;
      default:
        return false;
    }
  };

  const onSubmit = async (data: ChargeFormData) => {
    setLoading(true);
    try {
      const isInstallment = !isSubscription && installments > 1;
      const normalizedChargeType = isSubscription ? 'SUBSCRIPTION' : isInstallment ? 'INSTALLMENT' : 'ONE_TIME';
      const normalizedValue = data.value ?? 0;
      const installmentValue = isInstallment
        ? Number((normalizedValue / installments).toFixed(2))
        : undefined;
      const uiRequestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const payload: Record<string, unknown> = {
        payer: { type: data.payerType, [`${data.payerType}Id`]: data.payerId },
        chargeType: normalizedChargeType,
        billingType: data.billingType,
        description: data.description,
        notificationChannels: notificationChannels, // Canais de notificação selecionados
        notificationChannelsConfigured,
        uiRequestId,
      };

      if (normalizedChargeType === 'ONE_TIME') {
        payload.value = normalizedValue;
        payload.dueDate = data.dueDate;
      } else if (normalizedChargeType === 'INSTALLMENT') {
        payload.installmentCount = installments;
        payload.installmentValue = installmentValue;
        payload.dueDate = data.dueDate;
      } else if (normalizedChargeType === 'SUBSCRIPTION') {
        payload.value = normalizedValue;
        payload.nextDueDate = data.nextDueDate;
        payload.cycle = data.cycle;
        payload.endDate = data.endDate;
      }

      // Regras financeiras
      if (data.discountValue && data.discountValue > 0) {
        payload.discount = {
          value: data.discountValue,
          type: data.discountType || 'PERCENTAGE',
          dueDateLimitDays: data.discountDueDateLimitDays || undefined,
        };
      }
      if (data.interestValue && data.interestValue > 0) {
        payload.interest = { value: data.interestValue };
      }
      if (data.fineValue && data.fineValue > 0) {
        payload.fine = {
          value: data.fineValue,
          type: data.fineType || 'PERCENTAGE',
        };
      }

      const res = await fetch('/api/finance/charges/standalone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || result.error || 'Erro ao criar cobrança');
      }

      pushToast({
        title: labels.toast,
        description: 'Aguardando confirmação de pagamento',
        variant: 'success',
      });

      handleClose();
      onSuccess?.();
    } catch (err) {
      pushToast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Erro ao criar cobrança',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-50 p-0">
        <DialogTitle className="sr-only">{labels.title}</DialogTitle>

        <div className="relative rounded-t-2xl border-b border-slate-200 bg-slate-50 p-4 md:p-6">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{labels.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{labels.subtitle}</p>
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
              <Progress
                value={(step / 6) * 100}
                className="h-2 bg-transparent [&>div]:bg-gradient-to-r [&>div]:from-brand-accent [&>div]:to-brand-accent/70"
                aria-label="Progresso da cobrança"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((step / 6) * 100)}
              />
            </div>
            <div className="mt-2 text-xs font-medium text-slate-600" aria-live="polite">
              Etapa {step} de 6
            </div>
          </div>
        </div>

        <div className="flex max-h-[78vh] flex-col">
          <div
            className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
            style={{ scrollbarWidth: 'thin', scrollbarGutter: 'stable', scrollbarColor: '#d1d5db transparent' }}
          >
            <div className="mx-auto w-full max-w-4xl space-y-6">
              <form id="create-charge-form" onSubmit={(e) => e.preventDefault()}>
                {step === 1 && (
                  <SectionCard>
                    <StepHeader
                      title="Identifique o pagador"
                      hint="Busque pelo nome do aluno ou responsável financeiro."
                    />

                    {!selectedPayer ? (
                      <div className="space-y-4">
                        <Popover.Root open={searchOpen && searchQuery.length > 0} onOpenChange={setSearchOpen}>
                          <Popover.Anchor asChild>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none z-10" />
                              <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                  setSearchQuery(e.target.value);
                                  if (!searchOpen && e.target.value.trim()) setSearchOpen(true);
                                }}
                                onFocus={() => {
                                  if (searchQuery.trim()) setSearchOpen(true);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setSearchOpen(false);
                                }}
                                placeholder="Buscar aluno, responsável ou CPF..."
                                className="flex h-10 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 focus:border-gray-300"
                                aria-autocomplete="list"
                                aria-expanded={searchOpen}
                              />
                            </div>
                          </Popover.Anchor>

                          <Popover.Portal>
                            <Popover.Content
                              className="z-[99999] w-[var(--radix-popover-trigger-width)] max-h-[300px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl animate-in fade-in-0 zoom-in-95"
                              sideOffset={8}
                              align="start"
                              onOpenAutoFocus={(e) => e.preventDefault()}
                              onInteractOutside={(e) => {
                                if (e.target === searchInputRef.current) return;
                                setSearchOpen(false);
                              }}
                            >
                              <CommandPrimitive
                                shouldFilter={false}
                                className="max-h-[300px] overflow-y-auto"
                              >
                                <CommandPrimitive.List>
                                  {searching && (
                                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                                      <Refresh className="mx-auto h-5 w-5 animate-spin mb-2 opacity-50" />
                                      Buscando...
                                    </div>
                                  )}

                                  {!searching && searchResults.length === 0 && searchQuery.length >= 2 && (
                                    <CommandPrimitive.Empty className="px-4 py-8 text-center text-sm text-slate-500">
                                      Nenhum pagador encontrado.
                                    </CommandPrimitive.Empty>
                                  )}

                                  {!searching && searchResults.map((result) => (
                                    <CommandPrimitive.Item
                                      key={result.id}
                                      value={result.id}
                                      onSelect={() => handlePayerSelect(result)}
                                      className={cn(
                                        'cursor-pointer px-4 py-3 text-left text-sm transition-colors',
                                        'hover:bg-slate-50 aria-selected:bg-slate-50',
                                        'border-b border-slate-50 last:border-none'
                                      )}
                                    >
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-medium text-slate-900">{result.name}</span>
                                        {result.cpf && (
                                          <div className="text-xs text-slate-500">{maskCPF(result.cpf)}</div>
                                        )}
                                      </div>
                                    </CommandPrimitive.Item>
                                  ))}
                                </CommandPrimitive.List>
                              </CommandPrimitive>
                            </Popover.Content>
                          </Popover.Portal>
                        </Popover.Root>
                      </div>
                    ) : (
                      <div className="relative flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5c2f91]/15 text-sm font-semibold text-[#5c2f91]">
                          {payerInitials || 'A'}
                        </div>
                        <div className="flex-1 space-y-1 text-sm text-gray-700">
                          <p className="text-base font-semibold text-gray-900">{selectedPayer.name}</p>
                          {selectedPayer.cpf && (
                            <p className="text-xs font-medium text-gray-600 tracking-wide">
                              CPF: {maskCPF(selectedPayer.cpf)}
                            </p>
                          )}
                          {selectedPayer.responsibleName && (
                            <p className="text-xs text-gray-600">
                              Responsável:{' '}
                              <span className="font-medium text-gray-800">
                                {selectedPayer.responsibleName}
                              </span>
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPayer(null);
                            setSearchQuery('');
                            setSearchResults([]);
                            setTimeout(() => searchInputRef.current?.focus(), 100);
                          }}
                          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-white/60 hover:text-gray-600"
                          aria-label="Remover pagador selecionado"
                        >
                          <span className="text-lg leading-none">×</span>
                        </button>
                      </div>
                    )}
                  </SectionCard>
                )}

                {/* Step 2: Dados da cobrança */}
                {step === 2 && (
                  <SectionCard>
                    <StepHeader title="Dados da cobrança" hint="Defina tipo, valores e vencimento." />
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={isSubscription ? 'outline' : 'default'}
                          className={cn(
                            'h-9 px-4 text-sm',
                            isSubscription ? 'border-slate-200 text-slate-600' : 'bg-brand-accent text-white'
                          )}
                          onClick={() => {
                            setValue('chargeType', 'ONE_TIME');
                          }}
                        >
                          À vista ou parcelado
                        </Button>
                        <Button
                          type="button"
                          variant={isSubscription ? 'default' : 'outline'}
                          className={cn(
                            'h-9 px-4 text-sm',
                            isSubscription ? 'bg-brand-accent text-white' : 'border-slate-200 text-slate-600'
                          )}
                          onClick={() => {
                            setValue('chargeType', 'SUBSCRIPTION');
                          }}
                        >
                          Assinatura
                        </Button>
                      </div>

                      {!isSubscription && (
                        <>
                          <div className="space-y-1.5">
                            <FieldLabel required>Valor da cobrança (R$)</FieldLabel>
                            <Input
                              type="text"
                              inputMode="numeric"
                              placeholder={currencyFormatter.format(0)}
                              className="h-10"
                              value={value ? currencyFormatter.format(value) : ''}
                              onChange={(e) => {
                                const cents = parseCurrencyBRLToCents(e.target.value);
                                if (cents === null) {
                                  setValue('value', undefined);
                                  return;
                                }
                                setValue('value', cents / 100);
                              }}
                            />
                            {errors.value && <span className="text-xs text-destructive">{errors.value.message}</span>}
                          </div>

                          <div className="space-y-1.5">
                            <FieldLabel required>Parcelamento</FieldLabel>
                            <Select
                              value={String(installments)}
                              onValueChange={(v) => setInstallments(Number(v))}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 21 }, (_, i) => i + 1).map((count) => {
                                  const installmentValue = count > 0 ? value / count : 0;
                                  const label =
                                    count === 1
                                      ? `À vista (${formatCurrency(value)})`
                                      : `Em até ${count}x de ${formatCurrency(installmentValue || 0)}`;
                                  return (
                                    <SelectItem key={count} value={String(count)}>
                                      {label}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <FieldLabel required>Vencimento da cobrança</FieldLabel>
                            <Input
                              type="date"
                              min={today}
                              className="h-10"
                              onChange={(e) => setValue('dueDate', e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {isSubscription && (
                        <>
                          <div className="space-y-1.5">
                            <FieldLabel required>Valor da cobrança (R$)</FieldLabel>
                            <Input
                              type="text"
                              inputMode="numeric"
                              placeholder={currencyFormatter.format(0)}
                              className="h-10"
                              value={value ? currencyFormatter.format(value) : ''}
                              onChange={(e) => {
                                const cents = parseCurrencyBRLToCents(e.target.value);
                                if (cents === null) {
                                  setValue('value', undefined);
                                  return;
                                }
                                setValue('value', cents / 100);
                              }}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel required>Frequência da cobrança</FieldLabel>
                            <Select onValueChange={(v) => setValue('cycle', v as ChargeFormData['cycle'])}>
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="WEEKLY">Semanal</SelectItem>
                                <SelectItem value="BIWEEKLY">Quinzenal</SelectItem>
                                <SelectItem value="MONTHLY">Mensal</SelectItem>
                                <SelectItem value="BIMONTHLY">Bimestral</SelectItem>
                                <SelectItem value="QUARTERLY">Trimestral</SelectItem>
                                <SelectItem value="SEMIANNUALLY">Semestral</SelectItem>
                                <SelectItem value="YEARLY">Anual</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel required>Vencimento da 1ª cobrança</FieldLabel>
                            <Input
                              type="date"
                              min={today}
                              className="h-10"
                              onChange={(e) => setValue('nextDueDate', e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel required>Fim da assinatura</FieldLabel>
                            <Input
                              type="date"
                              min={today}
                              className="h-10"
                              onChange={(e) => setValue('endDate', e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      <div className="space-y-1.5">
                        <FieldLabel>Descrição (opcional)</FieldLabel>
                        <Textarea
                          placeholder="Ex: Mensalidade Janeiro/2026"
                          maxLength={500}
                          className="min-h-[96px]"
                          onChange={(e) => setValue('description', e.target.value)}
                        />
                      </div>
                    </div>
                  </SectionCard>
                )}

                {/* Step 3: Forma de pagamento */}
                {step === 3 && (
                  <SectionCard>
                    <StepHeader title="Forma de pagamento" hint="Defina como o cliente fará o pagamento." />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {paymentOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setValue('billingType', option.value as ChargeFormData['billingType'])}
                          className={cn(
                            'flex flex-col rounded-lg border p-3 text-left transition',
                            billingType === option.value
                              ? 'border-violet-500 bg-violet-50 text-violet-700'
                              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                          )}
                        >
                          <div className="text-2xl">{option.icon}</div>
                          <div className="mt-1 text-sm font-semibold">{option.label}</div>
                        </button>
                      ))}
                    </div>
                  </SectionCard>
                )}

                {/* Step 4: Notificações (opcional) */}
                {step === 4 && (
                  <SectionCard>
                    <StepHeader title="Notificações" hint="Selecione como a cobrança será enviada ao cliente." />
                    {loadingNotificationDefaults ? (
                      <p className="text-sm text-slate-500">Carregando configuração atual...</p>
                    ) : null}
                    {notificationDefaultsError ? (
                      <p className="text-sm text-amber-700">{notificationDefaultsError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      {[
                        { value: 'WHATSAPP' as const, label: 'WhatsApp' },
                        { value: 'EMAIL' as const, label: 'E-mail' },
                        { value: 'SMS' as const, label: 'SMS' },
                      ].map((option) => {
                        const active = notificationChannels.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setNotificationChannelsConfigured(true);
                              setNotificationChannels((prev) =>
                                prev.includes(option.value)
                                  ? prev.filter((item) => item !== option.value)
                                  : [...prev, option.value],
                              );
                            }}
                            className={cn(
                              'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition',
                              active
                                ? 'border-brand-accent bg-brand-accent text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {/* Step 5: Regras financeiras (opcional) */}
                {step === 5 && (
                  <SectionCard>
                    <StepHeader title="Juros, Multa e Descontos" hint="Configure regras opcionais para a cobrança." />
                    <div className="space-y-6">

                      {/* Juros */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">Juros</h4>
                        <p className="text-sm text-gray-500 mb-3">Aplique juros mensais para pagamentos após o vencimento.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <FieldLabel>Juros ao mês (%)</FieldLabel>
                            <div className="relative">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                className="h-10 pl-8 bg-white"
                                value={formatDecimalDisplay(watch('interestValue'))}
                                onChange={(e) => {
                                  const masked = formatPercentInput(e.target.value);
                                  const parsed = parseMaskedNumber(masked);
                                  setValue('interestValue', parsed);
                                }}
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm">%</span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <FieldLabel>Valor de juros ao mês</FieldLabel>
                            <div className="relative">
                              <Input
                                disabled
                                readOnly
                                value={((baseValue * (watch('interestValue') || 0)) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                className="h-10 pl-10 bg-gray-100 text-gray-500 font-medium"
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm font-bold">R$</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="h-px bg-gray-100" />

                      {/* Multa */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">Multa</h4>
                        <p className="text-sm text-gray-500 mb-3">Multa aplicada uma única vez após o vencimento.</p>

                        <div className="flex items-center gap-2 mb-3 bg-gray-50 p-1 rounded-lg w-fit">
                          <button
                            type="button"
                            onClick={() => setValue('fineType', 'PERCENTAGE')}
                            className={cn(
                              "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                              watch('fineType') !== 'FIXED' ? "bg-white shadow-sm text-brand-accent" : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            Percentual
                          </button>
                          <button
                            type="button"
                            onClick={() => setValue('fineType', 'FIXED')}
                            className={cn(
                              "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                              watch('fineType') === 'FIXED' ? "bg-white shadow-sm text-brand-accent" : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            Valor Fixo
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <FieldLabel>Valor da multa ({watch('fineType') === 'FIXED' ? 'R$' : '%'})</FieldLabel>
                            <div className="relative">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                className="h-10 pl-8"
                                value={formatDecimalDisplay(watch('fineValue'))}
                                onChange={(e) => {
                                  const masked =
                                    watch('fineType') === 'FIXED'
                                      ? formatBRLInput(e.target.value)
                                      : formatPercentInput(e.target.value);
                                  const parsed = parseMaskedNumber(masked);
                                  setValue('fineValue', parsed);
                                }}
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm">
                                {watch('fineType') === 'FIXED' ? 'R$' : '%'}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <FieldLabel>
                              {watch('fineType') === 'FIXED' ? 'Valor equivalente (%)' : 'Valor da multa (R$)'}
                            </FieldLabel>
                            <div className="relative">
                              <Input
                                disabled
                                readOnly
                                value={
                                  watch('fineType') === 'FIXED'
                                    ? (baseValue > 0 ? ((watch('fineValue') || 0) / baseValue * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00')
                                    : ((baseValue * (watch('fineValue') || 0)) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                }
                                className="h-10 pl-10 bg-gray-100 text-gray-500 font-medium"
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm font-bold">
                                {watch('fineType') === 'FIXED' ? '%' : 'R$'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="h-px bg-gray-100" />

                      {/* Desconto */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">Desconto</h4>
                        <p className="text-sm text-gray-500 mb-3">Conceda desconto para pagamento antecipado.</p>

                        <div className="flex items-center gap-2 mb-3 bg-gray-50 p-1 rounded-lg w-fit">
                          <button
                            type="button"
                            onClick={() => setValue('discountType', 'PERCENTAGE')}
                            className={cn(
                              "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                              watch('discountType') !== 'FIXED' ? "bg-white shadow-sm text-brand-accent" : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            Percentual
                          </button>
                          <button
                            type="button"
                            onClick={() => setValue('discountType', 'FIXED')}
                            className={cn(
                              "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                              watch('discountType') === 'FIXED' ? "bg-white shadow-sm text-brand-accent" : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            Valor Fixo
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <FieldLabel>Valor do desconto ({watch('discountType') === 'FIXED' ? 'R$' : '%'})</FieldLabel>
                            <div className="relative">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                className="h-10 pl-8"
                                value={formatDecimalDisplay(watch('discountValue'))}
                                onChange={(e) => {
                                  const masked =
                                    watch('discountType') === 'FIXED'
                                      ? formatBRLInput(e.target.value)
                                      : formatPercentInput(e.target.value);
                                  const parsed = parseMaskedNumber(masked);
                                  setValue('discountValue', parsed);
                                }}
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm">
                                {watch('discountType') === 'FIXED' ? 'R$' : '%'}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <FieldLabel>
                              {watch('discountType') === 'FIXED' ? 'Valor equivalente (%)' : 'Valor do desconto (R$)'}
                            </FieldLabel>
                            <div className="relative">
                              <Input
                                disabled
                                readOnly
                                value={
                                  watch('discountType') === 'FIXED'
                                    ? (baseValue > 0 ? ((watch('discountValue') || 0) / baseValue * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00')
                                    : ((baseValue * (watch('discountValue') || 0)) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                }
                                className="h-10 pl-10 bg-gray-100 text-gray-500 font-medium"
                              />
                              <span className="absolute left-3 top-2.5 text-gray-500 text-sm font-bold">
                                {watch('discountType') === 'FIXED' ? '%' : 'R$'}
                              </span>
                            </div>
                          </div>

                          <div className="col-span-1 sm:col-span-2 space-y-1.5">
                            <FieldLabel>Prazo máximo do desconto</FieldLabel>
                            <Select
                              value={String(watch('discountDueDateLimitDays') ?? 0)}
                              onValueChange={(v) => setValue('discountDueDateLimitDays', Number(v))}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Até o dia do vencimento</SelectItem>
                                <SelectItem value="1">1 dia antes do vencimento</SelectItem>
                                <SelectItem value="2">2 dias antes do vencimento</SelectItem>
                                <SelectItem value="5">5 dias antes do vencimento</SelectItem>
                                <SelectItem value="10">10 dias antes do vencimento</SelectItem>
                                <SelectItem value="15">15 dias antes do vencimento</SelectItem>
                                <SelectItem value="30">30 dias antes do vencimento</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                    </div>
                  </SectionCard>
                )}

                {/* Step 6: Resumo */}
                {step === 6 && (
                  <SectionCard>
                    <StepHeader title="Resumo" hint="Confirme os dados antes de gerar a cobrança." />

                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                          <p className="text-xs text-gray-600">Contratante</p>
                          <p className="text-sm font-semibold text-gray-900">{selectedPayer?.name ?? '—'}</p>
                          <p className="text-xs text-gray-500">
                            {selectedPayer?.cpf ? maskCPF(selectedPayer.cpf) : 'Sem CPF'}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 text-sm">
                        <div className="space-y-2">
                          <p className="text-gray-600">
                            Tipo:{' '}
                            <span className="font-medium text-gray-900">
                              {isSubscription ? 'Assinatura' : installments > 1 ? 'Parcelada' : 'À vista'}
                            </span>
                          </p>
                          <p className="text-gray-600">
                            Valor:{' '}
                            <span className="font-medium text-gray-900">
                              {!isSubscription && installments > 1
                                ? `${installments}x ${formatCurrency((value || 0) / installments)}`
                                : formatCurrency(value || 0)}
                            </span>
                          </p>
                          <p className="text-gray-600">
                            Vencimento:{' '}
                            <span className="font-medium text-gray-900">
                              {isSubscription ? formatDate(watch('nextDueDate')) : formatDate(watch('dueDate'))}
                            </span>
                          </p>
                          {isSubscription && (
                            <p className="text-gray-600">
                              Fim da assinatura:{' '}
                              <span className="font-medium text-gray-900">
                                {formatDate(watch('endDate'))}
                              </span>
                            </p>
                          )}
                          <p className="text-gray-600">
                            Pagamento:{' '}
                            <span className="font-medium text-gray-900">
                              {billingType === 'PIX'
                                ? 'Pix'
                                : billingType === 'BOLETO'
                                  ? 'Boleto'
                                  : billingType === 'CREDIT_CARD'
                                    ? 'Cartão'
                                    : 'Cliente escolhe'}
                            </span>
                          </p>
                          {notificationChannelsConfigured && (
                            <p className="text-gray-600">
                              Notificações:{' '}
                              <span className="font-medium text-gray-900">
                                {notificationChannels.length > 0
                                  ? notificationChannels
                                      .map((c) => (c === 'WHATSAPP' ? 'WhatsApp' : c === 'EMAIL' ? 'E-mail' : 'SMS'))
                                      .join(', ')
                                  : 'Nenhuma'}
                              </span>
                            </p>
                          )}
                          {watch('description') && (
                            <p className="text-gray-600">
                              Descrição:{' '}
                              <span className="font-medium text-gray-900">{watch('description')}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                )}
              </form>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-4 md:p-6">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={step === 1 ? handleClose : prevStep}
                disabled={loading}
                className="h-10 min-w-[140px] border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100"
              >
                {step === 1 ? (
                  'Cancelar'
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Voltar
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {step < 6 ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  disabled={!canProceed(step)}
                  className="h-10 min-w-[160px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
                >
                  Próximo
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleSubmit(onSubmit)}
                  disabled={loading}
                  className="h-10 min-w-[200px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
                >
                  {loading ? (
                    <>
                      <Refresh className="h-4 w-4 mr-2 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Confirmar cobrança
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
