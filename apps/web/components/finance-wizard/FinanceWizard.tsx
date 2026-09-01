"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, Loader2 } from 'lucide-react';

import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { maskCep, maskCpfCnpj, maskPhone } from '@alusa/lib/client';

import type { WizardCompanyType, WizardState } from '@alusa/finance/wizard-client';
import {
  completeWizard,
  getWizardState,
  saveWizardStep1,
  saveWizardStep2,
  saveWizardStep3,
  saveWizardStep4,
  saveWizardStep5,
  WizardApiError,
} from './wizard-service';

type PersonType = 'PF' | 'PJ';
type BillingCycle = 'monthly' | 'yearly';
type PlanCode = 'STARTER' | 'PREMIUM' | 'PRO';
type UiStep = 1 | 2 | 3 | 4 | 5 | 6;

type Draft = {
  schoolName: string;
  personType: PersonType | '';
  cpfCnpj: string;
  ownerName: string;
  birthDate: string;
  companyName: string;
  companyType: WizardCompanyType | '';
  mobilePhone: string;
  landlinePhone: string;
  incomeValue: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  province: string;
  complement: string;
  addressCity: string;
  addressState: string;
};

type CheckoutResponse = {
  checkoutUrl?: string;
  message?: string;
};

type TrialResponse = {
  stripeSubscriptionId?: string;
  trialEndsAt?: string | null;
  message?: string;
};

type PortalResponse = {
  portalUrl?: string;
  error?: string;
  message?: string;
};

type StripeCheckoutButtonState = 'idle' | 'opening' | 'waiting' | 'confirmed' | 'failed';

type PlatformBillingSummary = {
  account: {
    status?: string | null;
    planCode?: string | null;
    stripeSubscriptionId?: string | null;
    trialEndsAt?: string | null;
  } | null;
};

const TOTAL_STEPS = 6;
const FIELD_CLASS =
  'h-11 rounded-md border border-[#d8d3de] bg-white px-4 text-sm text-[#1f1b24] shadow-none outline-none transition placeholder:text-[#b9b2c2] hover:border-[#b8afc4] focus-visible:border-[#55298a] focus-visible:ring-2 focus-visible:ring-[#55298a]/15';

const COMPANY_TYPES: Array<{ value: WizardCompanyType; label: string }> = [
  { value: 'MEI', label: 'MEI - Microempreendedor Individual' },
  { value: 'LIMITED', label: 'LTDA - Sociedade Limitada' },
  { value: 'INDIVIDUAL', label: 'EI - Empresario Individual' },
  { value: 'ASSOCIATION', label: 'Associacao' },
];

const PLANS: Array<{
  code: PlanCode;
  name: string;
  students: string;
  price: string;
  features: string[];
}> = [
  {
    code: 'STARTER',
    name: 'Premium',
    students: 'ate 60 alunos ativos',
    price: 'R$ 149/mes',
    features: [
      'Plataforma completa',
      'Usuarios internos ilimitados',
      'Professores ilimitados',
      'Cadastros historicos ilimitados',
      'Todos os modulos inclusos',
    ],
  },
  {
    code: 'PREMIUM',
    name: 'Premium+',
    students: 'ate 150 alunos ativos',
    price: 'R$ 279/mes',
    features: [
      'Plataforma completa',
      'Usuarios internos ilimitados',
      'Professores ilimitados',
      'Cadastros historicos ilimitados',
      'Todos os modulos inclusos',
    ],
  },
  {
    code: 'PRO',
    name: 'Pro',
    students: 'ate 300 alunos ativos',
    price: 'R$ 499/mes',
    features: [
      'Plataforma completa',
      'Usuarios internos ilimitados',
      'Professores ilimitados',
      'Cadastros historicos ilimitados',
      'Todos os modulos inclusos',
    ],
  },
];

function formatMoneyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(amount);
}

function parseMoneyToNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits) / 100;
}

type ViaCepResponse = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

async function lookupCep(rawCep: string) {
  const cep = rawCep.replace(/\D/g, '');
  if (cep.length !== 8) return null;

  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!response.ok) return null;

  const data = (await response.json()) as ViaCepResponse;
  if (data?.erro) return null;

  return {
    address: data.logradouro ?? '',
    province: data.bairro ?? '',
    addressCity: data.localidade ?? '',
    addressState: data.uf ?? '',
  };
}

function makeDraft(wizard?: WizardState | null): Draft {
  return {
    schoolName: wizard?.schoolName ?? '',
    personType: wizard?.personType ?? '',
    cpfCnpj: wizard?.cpfCnpj ?? '',
    ownerName: wizard?.ownerName ?? '',
    birthDate: wizard?.birthDate ?? '',
    companyName: wizard?.companyName ?? '',
    companyType: wizard?.companyType ?? '',
    mobilePhone: wizard?.mobilePhone ?? '',
    landlinePhone: wizard?.landlinePhone ?? '',
    incomeValue:
      wizard?.incomeValue === null || wizard?.incomeValue === undefined
        ? ''
        : formatMoneyInput(String(Math.round(wizard.incomeValue * 100))),
    postalCode: wizard?.postalCode ?? '',
    address: wizard?.address ?? '',
    addressNumber: wizard?.addressNumber ?? '',
    province: wizard?.province ?? '',
    complement: wizard?.complement ?? '',
    addressCity: wizard?.addressCity ?? '',
    addressState: wizard?.addressState ?? '',
  };
}

function resolveInitialStep(wizard: WizardState): UiStep {
  if (wizard.completedAt || wizard.step === 6) return 6;
  if (wizard.address && wizard.incomeValue) return 4;
  if (wizard.cpfCnpj && wizard.mobilePhone && wizard.incomeValue) return 3;
  if (wizard.personType) return 2;
  return 1;
}

function extractError(error: unknown, fallback: string) {
  return error instanceof WizardApiError ? error.message : fallback;
}

function formatPersonType(type: Draft['personType']) {
  if (type === 'PF') return 'Pessoa fisica';
  if (type === 'PJ') return 'Pessoa juridica';
  return '';
}

function formatCompanyType(type: Draft['companyType']) {
  return COMPANY_TYPES.find((item) => item.value === type)?.label ?? '';
}

function formatBillingCycle(cycle: BillingCycle) {
  return cycle === 'monthly' ? 'Mensal' : 'Anual';
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#ece8f1] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7b7484]">{label}</p>
      <div className="mt-1 text-sm font-semibold text-[#211b27]">{value || 'Nao informado'}</div>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#e8e2ee] bg-[#fbfafd] p-4">
      <h2 className="text-sm font-semibold text-[#211b27]">{title}</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('grid gap-2 text-sm font-semibold text-[#17121c]', className)}>
      {label}
      {children}
    </label>
  );
}

function FinanceWizardShell({
  currentStep,
  children,
  footer,
}: {
  currentStep: UiStep;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const progress = Math.max(8, Math.round((currentStep / TOTAL_STEPS) * 100));

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-[#17121c]">
      <header className="pointer-events-none fixed left-0 top-0 z-20 flex w-full items-start justify-between px-6 pt-8 sm:px-[50px] sm:pt-[50px]">
        <BrandWordmark variant="purple" className="h-[39px]" />
        <div
          className="mt-1 h-2.5 w-[159px] overflow-hidden rounded-full bg-[#eeeaf2]"
          aria-label={`${progress}% concluido`}
        >
          <div className="h-full rounded-full bg-[#7a1ed2]" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <section className="flex min-h-screen items-center justify-center px-6 py-32 sm:px-10">
        {children}
      </section>

      <footer className="fixed bottom-0 left-0 z-20 flex w-full items-center justify-end gap-3 px-6 pb-8 sm:px-[50px] sm:pb-[50px]">
        {footer}
      </footer>
    </main>
  );
}

export function FinanceWizard() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [registerLaterLoading, setRegisterLaterLoading] = useState(false);
  const [checkoutPolling, setCheckoutPolling] = useState(false);
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [trialDeferred, setTrialDeferred] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [currentStep, setCurrentStep] = useState<UiStep>(1);
  const [draft, setDraft] = useState<Draft>(() => makeDraft(null));
  const [planCode, setPlanCode] = useState<PlanCode>('PREMIUM');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const lastCepLookupRef = useRef('');

  const financeIntegrationMode =
    (session?.user as { financeIntegrationMode?: string | null } | undefined)
      ?.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  const isExternalAsaasMode = financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';

  const selectedPlan = useMemo(
    () => PLANS.find((plan) => plan.code === planCode) ?? PLANS[1],
    [planCode],
  );
  const billingConfirmed = cardConfirmed || trialDeferred;
  const stripeButtonState: StripeCheckoutButtonState = cardConfirmed
    ? 'confirmed'
    : checkoutLoading
      ? 'opening'
      : checkoutPolling
        ? 'waiting'
        : checkoutFailed
          ? 'failed'
          : 'idle';

  const checkBillingConfirmation = useCallback(async () => {
    const response = await fetch('/api/platform-billing/summary', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) return false;

    const summary = (await response.json().catch(() => null)) as PlatformBillingSummary | null;
    const account = summary?.account;
    const status = account?.status ?? null;
    const hasSubscription = Boolean(account?.stripeSubscriptionId);
    const isConfirmedStatus = status === 'TRIALING' || status === 'ACTIVE';
    const isSamePlan = !account?.planCode || account.planCode === planCode;

    return hasSubscription && isConfirmedStatus && isSamePlan;
  }, [planCode]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        const result = await getWizardState(controller.signal);
        setWizardState(result.wizard);
        setDraft(makeDraft(result.wizard));
        setCurrentStep(resolveInitialStep(result.wizard));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          toast.error(extractError(error, 'Nao foi possivel carregar o onboarding financeiro.'));
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (trialDeferred) return;
    void checkBillingConfirmation()
      .then(setCardConfirmed)
      .catch(() => undefined);
  }, [checkBillingConfirmation, trialDeferred]);

  useEffect(() => {
    const cepDigits = draft.postalCode.replace(/\D/g, '');
    if (cepDigits.length !== 8 || cepDigits === lastCepLookupRef.current) return;

    let cancelled = false;
    lastCepLookupRef.current = cepDigits;
    setCepLoading(true);

    void lookupCep(cepDigits)
      .then((result) => {
        if (cancelled || !result) return;
        setDraft((current) => ({
          ...current,
          address: result.address || current.address,
          province: result.province || current.province,
          addressCity: result.addressCity || current.addressCity,
          addressState: result.addressState || current.addressState,
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCepLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.postalCode]);

  useEffect(() => {
    if (!checkoutPolling || cardConfirmed || trialDeferred) return;

    let cancelled = false;
    let attempts = 0;

    const intervalId = window.setInterval(() => {
      attempts += 1;
      void checkBillingConfirmation()
        .then((confirmed) => {
          if (cancelled) return;
          if (confirmed) {
            setCardConfirmed(true);
            setCheckoutFailed(false);
            setCheckoutPolling(false);
            toast.success('Cartao confirmado. O periodo de teste esta ativo.');
          } else if (attempts >= 45) {
            setCheckoutPolling(false);
            setCheckoutFailed(true);
          }
        })
        .catch(() => undefined);
    }, 4000);

    void checkBillingConfirmation()
      .then((confirmed) => {
        if (!cancelled && confirmed) {
          setCardConfirmed(true);
          setCheckoutFailed(false);
          setCheckoutPolling(false);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [cardConfirmed, checkBillingConfirmation, checkoutPolling, trialDeferred]);

  const updateDraft = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleBack = useCallback(() => {
    setCurrentStep((step) => (step > 1 ? ((step - 1) as UiStep) : step));
  }, []);

  const handleStart = useCallback(async () => {
    if (!draft.schoolName.trim()) {
      toast.error('Informe o nome da escola.');
      return;
    }

    if (!draft.personType) {
      toast.error('Selecione se a conta sera Pessoa Fisica ou Pessoa Juridica.');
      return;
    }

    try {
      setSaving(true);
      const result = await saveWizardStep1({ personType: draft.personType });
      setWizardState(result.wizard);
      setCurrentStep(2);
    } catch (error) {
      toast.error(extractError(error, 'Nao foi possivel salvar o tipo de conta.'));
    } finally {
      setSaving(false);
    }
  }, [draft.personType, draft.schoolName]);

  const handleOfficialData = useCallback(async () => {
    const personType = draft.personType || wizardState?.personType;
    if (!personType) {
      toast.error('Selecione o tipo de conta para continuar.');
      setCurrentStep(1);
      return;
    }

    try {
      setSaving(true);

      const step2 =
        personType === 'PJ'
          ? await saveWizardStep2({
              personType,
              schoolName: draft.schoolName,
              cpfCnpj: draft.cpfCnpj,
              companyName: draft.companyName,
              companyType: draft.companyType as WizardCompanyType,
            })
          : await saveWizardStep2({
              personType,
              schoolName: draft.schoolName,
              cpfCnpj: draft.cpfCnpj,
              ownerName: draft.ownerName,
              birthDate: draft.birthDate,
            });
      await saveWizardStep3({
        mobilePhone: draft.mobilePhone,
        landlinePhone: draft.landlinePhone,
        loginEmail: '',
      });
      const step5 = await saveWizardStep5({ incomeValue: parseMoneyToNumber(draft.incomeValue) });

      setWizardState({ ...step2.wizard, ...step5.wizard });
      setCurrentStep(3);
    } catch (error) {
      toast.error(extractError(error, 'Revise os dados oficiais antes de continuar.'));
    } finally {
      setSaving(false);
    }
  }, [draft, wizardState?.personType]);

  const handleAddress = useCallback(async () => {
    try {
      setSaving(true);
      const result = await saveWizardStep4({
        postalCode: draft.postalCode,
        address: draft.address,
        addressNumber: draft.addressNumber,
        province: draft.province,
        addressCity: draft.addressCity,
        addressState: draft.addressState,
        complement: draft.complement,
      });
      setWizardState(result.wizard);
      setCurrentStep(4);
    } catch (error) {
      toast.error(extractError(error, 'Revise o endereco oficial antes de continuar.'));
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const handleCheckout = useCallback(async () => {
    try {
      setCheckoutLoading(true);
      setCheckoutFailed(false);
      if (trialDeferred) {
        const response = await fetch('/api/platform-billing/portal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `finance-wizard-portal:${planCode}:${Date.now()}`,
          },
          body: JSON.stringify({ returnPath: '/finance/wizard' }),
        });

        const json = (await response.json().catch(() => null)) as PortalResponse | null;
        if (!response.ok || !json?.portalUrl) {
          throw new Error(json?.message ?? json?.error ?? 'Nao foi possivel abrir a area de pagamento.');
        }

        const portalWindow = window.open(json.portalUrl, '_blank');
        if (!portalWindow) {
          window.location.assign(json.portalUrl);
          return;
        }
        portalWindow.opener = null;
        return;
      }

      const response = await fetch('/api/platform-billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `finance-wizard:${planCode}:${Date.now()}`,
        },
        body: JSON.stringify({ planCode }),
      });

      const json = (await response.json().catch(() => null)) as CheckoutResponse | null;
      if (!response.ok || !json?.checkoutUrl) {
        throw new Error(json?.message ?? 'Nao foi possivel abrir o checkout.');
      }

      const checkoutWindow = window.open(json.checkoutUrl, '_blank');
      if (!checkoutWindow) {
        window.location.assign(json.checkoutUrl);
        return;
      }
      checkoutWindow.opener = null;

      setCheckoutPolling(true);
      toast.info('Finalize o cadastro do cartao na aba da Stripe. Vamos aguardar a confirmacao aqui.');
    } catch (error) {
      setCheckoutFailed(true);
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel abrir o checkout.');
    } finally {
      setCheckoutLoading(false);
    }
  }, [planCode, trialDeferred]);

  const handleRegisterLater = useCallback(async () => {
    try {
      setRegisterLaterLoading(true);
      const idempotencyKey = `finance-wizard-register-later:${planCode}:${Date.now()}`;
      const response = await fetch('/api/platform-billing/trial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ planCode, idempotencyKey }),
      });

      const json = (await response.json().catch(() => null)) as TrialResponse | null;
      if (!response.ok || !json?.stripeSubscriptionId) {
        throw new Error(json?.message ?? 'Nao foi possivel iniciar o teste.');
      }

      setCheckoutPolling(false);
      setCheckoutFailed(false);
      setTrialDeferred(true);
      setCardConfirmed(false);
      setCurrentStep(6);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel iniciar o teste.');
    } finally {
      setRegisterLaterLoading(false);
    }
  }, [planCode]);

  const handleCompleteWizard = useCallback(async () => {
    setCompleting(true);

    try {
      setSaving(true);
      const result = await completeWizard();

      if (!result.success) {
        setCompleting(false);
        toast.error(result.error?.message || 'Nao foi possivel confirmar a criacao da conta.');
        return;
      }

      setWizardState(result.wizard);
      await updateSession().catch(() => undefined);

      if (isExternalAsaasMode) {
        toast.success('Perfil confirmado. Conecte sua conta de pagamentos pelo dashboard.');
        router.replace('/dashboard');
        return;
      }

      if (result.provisioningStatus === 'QUEUED') {
        toast.info('Estamos criando sua conta de pagamentos. Em geral leva poucos minutos.');
      } else {
        toast.success('Conta financeira confirmada com sucesso.');
      }

      router.replace('/dashboard');
    } catch (error) {
      setCompleting(false);
      toast.error(extractError(error, 'Nao foi possivel confirmar a criacao da conta.'));
    } finally {
      setSaving(false);
    }
  }, [isExternalAsaasMode, router, updateSession]);

  if (completing) {
    return <AlusaLogoLoader fullScreen />;
  }

  if (loading) {
    return (
      <FinanceWizardShell currentStep={1} footer={null}>
        <Loader2 className="h-8 w-8 animate-spin text-[#5b2d90]" />
      </FinanceWizardShell>
    );
  }

  const footer = (
    <>
      {currentStep > 1 ? (
        <Button
          type="button"
          variant="ghost"
          onClick={handleBack}
          disabled={saving || checkoutLoading || registerLaterLoading}
          className="h-11 rounded-md px-5 text-sm font-semibold text-[#6f6878] shadow-none hover:bg-[#f5f2f8] hover:text-[#211b27]"
        >
          Voltar
        </Button>
      ) : null}
      <Button
        type="button"
        onClick={
          currentStep === 1
            ? handleStart
            : currentStep === 2
              ? handleOfficialData
              : currentStep === 3
                ? handleAddress
                : currentStep === 4
                  ? () => setCurrentStep(5)
                  : currentStep === 5
                    ? () => setCurrentStep(6)
                    : handleCompleteWizard
        }
        disabled={saving || checkoutLoading || registerLaterLoading || (currentStep === 5 && !billingConfirmed)}
        className="h-11 w-[151px] rounded-md bg-[#55298a] text-sm font-semibold text-white shadow-none transition hover:bg-[#4a2379] disabled:bg-[#d7d0df] disabled:text-white"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : currentStep === 6 ? 'Confirmar' : 'Continuar'}
      </Button>
    </>
  );

  return (
    <FinanceWizardShell currentStep={currentStep} footer={footer}>
      {currentStep === 1 ? (
        <div className="w-full max-w-[448px]">
          <h1 className="max-w-[416px] text-xl leading-6 text-[#17121c]">
            <span className="font-semibold text-[#721fc8]">Bem-vindo à Alusa.</span> Conte um
            pouco sobre sua escola e cuidaremos de tudo para você.
          </h1>

          <div className="mt-[30px] grid gap-[25px]">
            <Field label="Nome da escola">
              <Input
                value={draft.schoolName}
                onChange={(event) => updateDraft('schoolName', event.target.value)}
                placeholder="Digite o nome da sua escola"
                className={FIELD_CLASS}
              />
            </Field>

            <Field label="Tipo de conta">
              <Select
                value={draft.personType}
                onValueChange={(value) => updateDraft('personType', value as PersonType)}
              >
                <SelectTrigger className={cn(FIELD_CLASS, 'font-normal text-neutral-700')}>
                  <SelectValue placeholder="Pessoa jurídica ou pessoa física?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PJ">Pessoa jurídica</SelectItem>
                  <SelectItem value="PF">Pessoa física</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      ) : null}

      {currentStep === 2 ? (
        <div className="w-full max-w-[448px]">
          {draft.personType === 'PF' ? (
            <h1 className="text-xl leading-6 text-[#17121c]">
              Agora, informe os dados oficiais vinculados ao{' '}
              <span className="font-semibold">CPF do responsável pela escola.</span>
            </h1>
          ) : (
            <h1 className="text-xl leading-6 text-[#17121c]">
              Agora, informe os dados oficiais vinculados ao{' '}
              <span className="font-semibold">CNPJ da sua escola.</span>
            </h1>
          )}

          <div className="mt-[31px] grid gap-[25px]">
            <Field label={draft.personType === 'PF' ? 'CPF *' : 'CNPJ *'}>
              <Input
                value={maskCpfCnpj(draft.cpfCnpj)}
                onChange={(event) => updateDraft('cpfCnpj', event.target.value)}
                placeholder={draft.personType === 'PF' ? 'Digite o CPF' : 'Digite o CNPJ'}
                className={FIELD_CLASS}
              />
            </Field>

            {draft.personType === 'PF' ? (
              <>
                <Field label="Nome completo *">
                  <Input
                    value={draft.ownerName}
                    onChange={(event) => updateDraft('ownerName', event.target.value)}
                    placeholder="Digite o nome completo"
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Data de nascimento *">
                  <Input
                    type="date"
                    value={draft.birthDate}
                    onChange={(event) => updateDraft('birthDate', event.target.value)}
                    className={cn(FIELD_CLASS, 'text-neutral-700')}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Razão social *">
                  <Input
                    value={draft.companyName}
                    onChange={(event) => updateDraft('companyName', event.target.value)}
                    placeholder="Digite a razão social"
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Tipo de empresa *">
                  <Select
                    value={draft.companyType}
                    onValueChange={(value) => updateDraft('companyType', value as WizardCompanyType)}
                  >
                    <SelectTrigger className={cn(FIELD_CLASS, 'font-normal text-neutral-700')}>
                      <SelectValue placeholder="Selecione o tipo de empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPANY_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Telefone celular *">
                <Input
                  value={maskPhone(draft.mobilePhone)}
                  onChange={(event) => updateDraft('mobilePhone', event.target.value)}
                  placeholder="Digite o número com DDD"
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Telefone fixo (opcional)">
                <Input
                  value={maskPhone(draft.landlinePhone)}
                  onChange={(event) => updateDraft('landlinePhone', event.target.value)}
                  placeholder="Digite o número com DDD"
                  className={FIELD_CLASS}
                />
              </Field>
            </div>

            <Field label="Faturamento mensal (R$) *">
              <Input
                value={draft.incomeValue}
                onChange={(event) => updateDraft('incomeValue', formatMoneyInput(event.target.value))}
                placeholder="R$ 0,00"
                inputMode="numeric"
                className={FIELD_CLASS}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {currentStep === 3 ? (
        <div className="w-full max-w-[448px]">
          <h1 className="max-w-[390px] text-xl leading-6 text-[#17121c]">
            Informe o endereço cadastrado oficialmente para a empresa.
          </h1>

          <div className="mt-[31px] grid gap-[18px]">
            <div className="grid grid-cols-[131px_1fr] gap-[13px]">
              <Field label="CEP *">
                <div className="relative">
                  <Input
                    value={maskCep(draft.postalCode)}
                    onChange={(event) => updateDraft('postalCode', event.target.value)}
                    placeholder="00000-000"
                    className={cn(FIELD_CLASS, cepLoading && 'pr-9')}
                  />
                  {cepLoading ? (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#55298a]" />
                  ) : null}
                </div>
              </Field>
              <Field label="Rua *">
                <Input
                  value={draft.address}
                  onChange={(event) => updateDraft('address', event.target.value)}
                  placeholder="Rua / Avenida"
                  className={FIELD_CLASS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-[1fr_131px] gap-[13px]">
              <Field label="Bairro *">
                <Input
                  value={draft.province}
                  onChange={(event) => updateDraft('province', event.target.value)}
                  placeholder="Bairro"
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Número *">
                <Input
                  value={draft.addressNumber}
                  onChange={(event) => updateDraft('addressNumber', event.target.value)}
                  placeholder="N."
                  className={FIELD_CLASS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-[1fr_131px] gap-[13px]">
              <Field label="Complemento">
                <Input
                  value={draft.complement}
                  onChange={(event) => updateDraft('complement', event.target.value)}
                  placeholder="Complemento"
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Estado *">
                <Input
                  value={draft.addressState}
                  onChange={(event) => updateDraft('addressState', event.target.value.toUpperCase())}
                  placeholder="UF"
                  maxLength={2}
                  className={FIELD_CLASS}
                />
              </Field>
            </div>

            <Field label="Cidade *">
              <Input
                value={draft.addressCity}
                onChange={(event) => updateDraft('addressCity', event.target.value)}
                placeholder="Cidade"
                className={FIELD_CLASS}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {currentStep === 4 ? (
        <div className="w-full max-w-[493px]">
          <h1 className="max-w-[443px] text-xl leading-6 text-[#17121c]">
            <span className="font-semibold">Escolha o plano da sua escola.</span> Comece com 14
            dias grátis e cadastre um cartão para ativar o período de teste.
          </h1>

          <div className="mt-7 rounded-md border border-[#e3ddea] bg-white px-[30px] py-7">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-[#17121c]">Selecione um plano</h2>
              <div className="flex h-[39px] rounded-md bg-[#eeeaf2] p-1 text-sm font-semibold text-[#3d3446]">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={cn(
                    'h-[31px] w-[90px] rounded-md bg-transparent transition',
                    billingCycle === 'monthly' && 'bg-white',
                  )}
                >
                  Mensal
                </button>
                <button
                  type="button"
                  disabled
                  title="Ciclo anual em breve"
                  className={cn(
                    'h-[31px] w-[78px] rounded-md bg-transparent text-[#9a92a5] transition disabled:cursor-not-allowed',
                    billingCycle === 'yearly' && 'bg-white',
                  )}
                >
                  Anual
                </button>
              </div>
            </div>

            <div className="mt-7 grid gap-2">
              {PLANS.map((plan) => {
                const selected = plan.code === planCode;
                return (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setPlanCode(plan.code)}
                    className={cn(
                      'rounded-md border border-[#eeeaf3] bg-white p-4 text-left transition hover:border-[#cfc4dd]',
                      selected && 'border-[#e5d7f5] bg-[#f3ebfb]',
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={cn(
                          'mt-1 h-[23px] w-[23px] rounded-full border border-[#c8c0d1] bg-white',
                          selected && 'border-[3px] border-[#55298a]',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-[#17121c]">{plan.name}</span>
                        <span className="block text-sm text-[#6f6878]">{plan.students}</span>
                      </span>
                      <span className="text-xl font-semibold text-[#17121c]">{plan.price}</span>
                    </div>

                    {selected ? (
                      <div className="ml-[57px] mt-5 grid gap-3 text-sm text-[#4d4557]">
                        {plan.features.map((feature) => (
                          <span key={feature} className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-[#55298a]" />
                            {feature}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {currentStep === 5 ? (
        <div className="w-full max-w-[493px]">
          <h1 className="text-xl leading-6 text-[#17121c]">
            <span className="font-semibold">Cadastre seu cartão para ativar os 14 dias grátis.</span>{' '}
            Você será direcionado para o ambiente seguro da Stripe e retornará à Alusa após a
            confirmação.
          </h1>

          <div className="mt-8 rounded-md border border-[#e3ddea] bg-white p-6 shadow-[0_0_0_4px_#f5f2f8]">
            <div className="flex items-center gap-4">
              <span className="h-[23px] w-[23px] rounded-full border-[3px] border-[#55298a]" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-[#17121c]">{selectedPlan.name}</p>
                <p className="text-sm text-[#6f6878]">{selectedPlan.students}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-[#6f6878]">Após o período teste</p>
                <p className="text-xl font-semibold text-[#17121c]">{selectedPlan.price}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCheckout}
            disabled={stripeButtonState === 'opening' || stripeButtonState === 'waiting' || cardConfirmed}
            className="mt-9 flex h-[50px] w-full items-center justify-center gap-2 rounded-md bg-[#635bff] text-xl font-semibold text-white transition hover:bg-[#5851e6] disabled:cursor-not-allowed disabled:bg-[#a49ff8]"
          >
            {stripeButtonState === 'opening' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Abrindo Stripe...
              </>
            ) : stripeButtonState === 'waiting' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Aguardando confirmação da Stripe...
              </>
            ) : stripeButtonState === 'confirmed' ? (
              <>
                <Check className="h-5 w-5" />
                Cartão confirmado
              </>
            ) : stripeButtonState === 'failed' ? (
              'Tentar novamente'
            ) : (
              <>
                Cadastrar cartão com a
                <img
                  src="/integrations/stripe-logo.svg"
                  alt="Stripe"
                  className="pointer-events-none h-[29px] w-auto select-none brightness-0 invert"
                  draggable={false}
                />
              </>
            )}
          </button>

          {!cardConfirmed ? (
            <button
              type="button"
              onClick={handleRegisterLater}
              disabled={registerLaterLoading || checkoutLoading || checkoutPolling}
              className="mx-auto mt-3 block px-1 py-2 text-sm font-semibold text-[#55298a] underline-offset-4 transition hover:underline disabled:cursor-not-allowed disabled:text-[#a79caf] disabled:no-underline"
            >
              {registerLaterLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cadastrar depois
                </span>
              ) : (
                'Cadastrar depois'
              )}
            </button>
          ) : null}

        </div>
      ) : null}

      {currentStep === 6 ? (
        <div className="w-full max-w-[760px]">
          <h1 className="max-w-[560px] text-xl leading-6 text-[#17121c]">
            <span className="font-semibold">Revise os dados antes de confirmar.</span> Depois disso,
            vamos preparar a conta financeira da escola com segurança.
          </h1>
          <p className="mt-3 max-w-[600px] text-sm leading-6 text-[#6f6878]">
            {isExternalAsaasMode
              ? 'Como você já usa uma conta de pagamentos, a Alusa vai confirmar o perfil e seguir para a conexão segura dessa conta.'
              : 'No modo padrão, a Alusa cria a conta de pagamentos vinculada à escola e acompanha a ativação automaticamente.'}
          </p>

          <div className="mt-8 grid gap-4">
            <ReviewSection title="Dados da escola">
              <SummaryItem label="Nome da escola" value={draft.schoolName} />
              <SummaryItem label="Tipo de conta" value={formatPersonType(draft.personType)} />
              <SummaryItem
                label={draft.personType === 'PF' ? 'CPF' : 'CNPJ'}
                value={maskCpfCnpj(draft.cpfCnpj)}
              />
              {draft.personType === 'PF' ? (
                <>
                  <SummaryItem label="Responsável" value={draft.ownerName} />
                  <SummaryItem label="Data de nascimento" value={draft.birthDate} />
                </>
              ) : (
                <>
                  <SummaryItem label="Razão social" value={draft.companyName} />
                  <SummaryItem label="Tipo de empresa" value={formatCompanyType(draft.companyType)} />
                </>
              )}
            </ReviewSection>

            <ReviewSection title="Contato e faturamento">
              <SummaryItem label="Telefone celular" value={maskPhone(draft.mobilePhone)} />
              <SummaryItem label="Telefone fixo" value={maskPhone(draft.landlinePhone)} />
              <SummaryItem label="Faturamento mensal" value={draft.incomeValue} />
            </ReviewSection>

            <ReviewSection title="Endereço oficial">
              <SummaryItem label="CEP" value={maskCep(draft.postalCode)} />
              <SummaryItem label="Rua" value={draft.address} />
              <SummaryItem label="Número" value={draft.addressNumber} />
              <SummaryItem label="Bairro" value={draft.province} />
              <SummaryItem label="Complemento" value={draft.complement} />
              <SummaryItem label="Cidade" value={draft.addressCity} />
              <SummaryItem label="Estado" value={draft.addressState} />
            </ReviewSection>

            <ReviewSection title="Plano e ativação">
              <SummaryItem label="Plano" value={selectedPlan.name} />
              <SummaryItem label="Valor" value={selectedPlan.price} />
              <SummaryItem label="Ciclo" value={formatBillingCycle(billingCycle)} />
              <SummaryItem label="Capacidade" value={selectedPlan.students} />
              <SummaryItem label="Cartão" value={cardConfirmed ? 'Confirmado' : trialDeferred ? 'Cadastrar depois' : 'Pendente'} />
              <SummaryItem
                label="Modo da conta"
                value={isExternalAsaasMode ? 'Conectar conta existente' : 'Criar conta padrão'}
              />
            </ReviewSection>
          </div>
        </div>
      ) : null}
    </FinanceWizardShell>
  );
}
