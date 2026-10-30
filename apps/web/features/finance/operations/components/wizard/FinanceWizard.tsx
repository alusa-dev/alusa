"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';

import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { SlidingNumber } from '@/components/core/sliding-number';
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
import { getSchoolPricingTier } from '@/lib/school-pricing-ui';
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
type UiStep = 1 | 2 | 3 | 4 | 5;
type InvitationCondition = { conditionType: 'STANDARD' | 'CUSTOM'; studentCount: number | null; monthlyAmountCents: number | null; customBaseMonthlyAmountCents?: number | null; customIncludedStudentCount?: number | null; customMonthlyOverageAmountCents?: number | null; trialDays: number; currentConditionVersion: number; acceptedCurrentVersion: boolean; acceptedStudentCount: number | null; acceptedPlanCode: string | null; acceptedMonthlyAmountCents: number | null };

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
  subaccountEmail: string;
  incomeValue: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  province: string;
  complement: string;
  addressCity: string;
  addressState: string;
};

const TOTAL_STEPS = 5;
const FIELD_CLASS =
  'h-11 rounded-md border border-[#d8d3de] bg-white px-4 text-sm text-[#1f1b24] shadow-none outline-none transition placeholder:text-[#b9b2c2] hover:border-[#b8afc4] focus-visible:border-[#55298a] focus-visible:ring-2 focus-visible:ring-[#55298a]/15';

const COMPANY_TYPES: Array<{ value: WizardCompanyType; label: string }> = [
  { value: 'MEI', label: 'MEI - Microempreendedor Individual' },
  { value: 'LIMITED', label: 'LTDA - Sociedade Limitada' },
  { value: 'INDIVIDUAL', label: 'EI - Empresario Individual' },
  { value: 'ASSOCIATION', label: 'Associacao' },
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
    subaccountEmail: wizard?.subaccountEmail ?? '',
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
  if (wizard.completedAt || wizard.step === 6) return 5;
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
  direction,
  children,
  footer,
}: {
  currentStep: UiStep;
  direction: 1 | -1;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const progress = Math.max(8, Math.round((currentStep / TOTAL_STEPS) * 100));
  const prefersReducedMotion = useReducedMotion();
  const stepVariants = {
    enter: (stepDirection: number) => ({
      opacity: prefersReducedMotion ? 1 : 0,
      x: prefersReducedMotion ? 0 : stepDirection * 20,
    }),
    center: { opacity: 1, x: 0 },
    exit: (stepDirection: number) => ({
      opacity: prefersReducedMotion ? 1 : 0,
      x: prefersReducedMotion ? 0 : stepDirection * -20,
    }),
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-[#17121c]">
      <header className="pointer-events-none fixed left-0 top-0 z-20 flex w-full items-start justify-between px-6 pt-8 sm:px-[50px] sm:pt-[50px]">
        <BrandWordmark variant="purple" className="h-[39px]" />
        <div
          className="mt-1 h-2.5 w-[159px] overflow-hidden rounded-full bg-[#eeeaf2]"
          aria-label={`${progress}% concluido`}
        >
          <motion.div
            className="h-full rounded-full bg-[#7a1ed2]"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.45,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        </div>
      </header>

      <section className="flex min-h-screen items-center justify-center px-6 py-32 sm:px-10">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              duration: prefersReducedMotion ? 0 : 0.24,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex w-full justify-center"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </section>

      <footer className="fixed bottom-0 left-0 z-20 flex w-full items-center justify-end gap-3 px-6 pb-8 sm:px-[50px] sm:pb-[50px]">
        {footer}
      </footer>
    </main>
  );
}

export function FinanceWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStudentCount = Number(searchParams.get('studentCount'));
  const selectedCountFromPricing = Number.isSafeInteger(requestedStudentCount)
    && requestedStudentCount >= 1
    && requestedStudentCount <= 2_147_483_647
    ? requestedStudentCount
    : null;
  const { data: session, update: updateSession } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [currentStep, setCurrentStep] = useState<UiStep>(1);
  const [transitionDirection, setTransitionDirection] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft>(() => makeDraft(null));
  const [studentCount, setStudentCount] = useState(165);
  const [invitationCondition, setInvitationCondition] = useState<InvitationCondition | null>(null);
  const [conditionAccepted, setConditionAccepted] = useState(false);
  const [provisioningPending, setProvisioningPending] = useState(false);
  const lastCepLookupRef = useRef('');

  const financeIntegrationMode =
    (session?.user as { financeIntegrationMode?: string | null } | undefined)
      ?.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  const isExternalAsaasMode = financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';

  // The declared student count is persisted with step 5 and the server derives its price band.
  const isCustomInvitation = invitationCondition?.conditionType === 'CUSTOM';
  const selectedTier = isCustomInvitation ? null : getSchoolPricingTier(studentCount);
  const monthlyPrice = isCustomInvitation && invitationCondition.monthlyAmountCents !== null
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(invitationCondition.monthlyAmountCents / 100)
    : selectedTier ? new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(selectedTier.price) : 'Condição personalizada';
  const needsSpecialist = studentCount > 500 && !isCustomInvitation;
  const trialDays = invitationCondition?.trialDays ?? 14;
  const selectedPlanCode = isCustomInvitation ? 'CUSTOM' : selectedTier?.code ?? null;
  const selectedMonthlyAmountCents = isCustomInvitation
    ? invitationCondition?.monthlyAmountCents ?? null
    : selectedTier ? Math.round(selectedTier.price * 100) : null;
  const acceptedSelectionMatches = Boolean(invitationCondition?.acceptedCurrentVersion
    && invitationCondition.acceptedStudentCount === studentCount
    && invitationCondition.acceptedPlanCode === selectedPlanCode
    && invitationCondition.acceptedMonthlyAmountCents === selectedMonthlyAmountCents);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        const [result, conditionResponse] = await Promise.all([
          getWizardState(controller.signal),
          fetch('/api/platform-billing/onboarding-condition', { cache: 'no-store', signal: controller.signal }).then((response) => response.ok ? response.json() : null),
        ]);
        const condition = conditionResponse?.data as InvitationCondition | null;
        if (condition) {
          setInvitationCondition(condition);
          setConditionAccepted(condition.acceptedCurrentVersion);
        }
        setWizardState(result.wizard);
        setDraft(makeDraft(result.wizard));
        setStudentCount(selectedCountFromPricing ?? (condition?.conditionType === 'CUSTOM'
          ? condition.studentCount ?? 165
          : result.wizard.onboardingStudentCount ?? condition?.studentCount ?? 165));
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
  }, [selectedCountFromPricing]);

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

  const updateDraft = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const goToStep = useCallback((nextStep: UiStep) => {
    setTransitionDirection(nextStep >= currentStep ? 1 : -1);
    setCurrentStep(nextStep);
  }, [currentStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) goToStep((currentStep - 1) as UiStep);
  }, [currentStep, goToStep]);

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
      goToStep(2);
    } catch (error) {
      toast.error(extractError(error, 'Nao foi possivel salvar o tipo de conta.'));
    } finally {
      setSaving(false);
    }
  }, [draft.personType, draft.schoolName, goToStep]);

  const handleOfficialData = useCallback(async () => {
    const personType = draft.personType || wizardState?.personType;
    if (!personType) {
      toast.error('Selecione o tipo de conta para continuar.');
      goToStep(1);
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
        subaccountEmail: draft.subaccountEmail,
      });
      const step5 = await saveWizardStep5({
        incomeValue: parseMoneyToNumber(draft.incomeValue),
        onboardingStudentCount: studentCount,
      });

      setWizardState({ ...step2.wizard, ...step5.wizard });
      goToStep(3);
    } catch (error) {
      toast.error(extractError(error, 'Revise os dados oficiais antes de continuar.'));
    } finally {
      setSaving(false);
    }
  }, [draft, goToStep, studentCount, wizardState?.personType]);

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
      goToStep(4);
    } catch (error) {
      toast.error(extractError(error, 'Revise o endereco oficial antes de continuar.'));
    } finally {
      setSaving(false);
    }
  }, [draft, goToStep]);

  const handleCompleteWizard = useCallback(async () => {
    if (invitationCondition && !conditionAccepted) {
      toast.error('Leia e aceite a condição comercial vigente para continuar.');
      return;
    }
    setCompleting(true);

    try {
      setSaving(true);
      await saveWizardStep5({
        incomeValue: parseMoneyToNumber(draft.incomeValue),
        onboardingStudentCount: studentCount,
      });
      const result = await completeWizard();

      if (!result.success) {
        setCompleting(false);
        if (result.error?.code === 'ASAAS_EMAIL_IN_USE') goToStep(2);
        toast.error(result.error?.message || 'Nao foi possivel confirmar a criacao da conta.');
        return;
      }
      setWizardState(result.wizard);

      if (invitationCondition && !acceptedSelectionMatches) {
        const acceptanceResponse = await fetch('/api/platform-billing/onboarding-condition/acceptance', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accepted: true, version: invitationCondition.currentConditionVersion, selectedStudentCount: studentCount }),
        });
        if (!acceptanceResponse.ok) {
          setCompleting(false);
          toast.error('A condição comercial foi atualizada. Recarregue o onboarding para revisar e aceitar a versão atual.');
          return;
        }
        const acceptance = await acceptanceResponse.json().catch(() => null) as {
          version?: number; selectedStudentCount?: number; selectedPlanCode?: string | null; selectedMonthlyAmountCents?: number | null;
        } | null;
        if (acceptance?.version !== invitationCondition.currentConditionVersion
          || acceptance.selectedStudentCount !== studentCount
          || acceptance.selectedPlanCode !== selectedPlanCode
          || acceptance.selectedMonthlyAmountCents !== selectedMonthlyAmountCents) {
          setCompleting(false);
          toast.error('Não foi possível confirmar o aceite da condição selecionada. Revise os dados e tente novamente.');
          return;
        }
        setInvitationCondition({ ...invitationCondition, acceptedCurrentVersion: true, acceptedStudentCount: studentCount, acceptedPlanCode: selectedPlanCode, acceptedMonthlyAmountCents: selectedMonthlyAmountCents });
        setConditionAccepted(true);
      }

      if (!isExternalAsaasMode && result.provisioningStatus === 'QUEUED') {
        setProvisioningPending(true);
        await updateSession().catch(() => undefined);
        setCompleting(false);
        toast.info('Estamos configurando sua conta de pagamentos. O teste grátis ainda não começou. Quando a conexão estiver pronta, volte aqui e clique em “Verificar conexão e continuar”.');
        return;
      }

      let trialDurationDays = 14;
      if (!needsSpecialist) {
        const idempotencyKey = 'onboarding-trial:initial';
        const trialResponse = await fetch('/api/platform-billing/trial', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body: JSON.stringify({}),
        });
        const trialPayload = await trialResponse.json().catch(() => null) as { error?: string; message?: string; trialEndsAt?: string | null } | null;
        if (trialPayload?.error === 'CHECKOUT_REQUIRED') {
          const checkoutResponse = await fetch('/api/platform-billing/checkout', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': 'onboarding-checkout:initial' },
            body: JSON.stringify({}),
          });
          const checkoutPayload = await checkoutResponse.json().catch(() => null) as { checkoutUrl?: string; message?: string } | null;
          if (!checkoutResponse.ok || !checkoutPayload?.checkoutUrl) {
            setCompleting(false);
            toast.error(checkoutPayload?.message ?? 'A configuração terminou, mas não foi possível abrir a contratação. Tente novamente.');
            return;
          }
          window.location.assign(checkoutPayload.checkoutUrl);
          return;
        }
        if (!trialResponse.ok) {
          if (trialPayload?.error === 'FINANCE_ONBOARDING_PENDING') {
            await updateSession().catch(() => undefined);
            if (isExternalAsaasMode) {
              setCompleting(false);
              toast.info('Seu perfil foi salvo. Conecte sua conta Asaas; depois, volte ao wizard para iniciar o teste grátis.');
              router.replace('/admin/settings/integrations/asaas');
              return;
            }
            setProvisioningPending(true);
            setCompleting(false);
            toast.info('A conexão financeira ainda está sendo concluída. O teste grátis não começou. Quando estiver pronta, volte aqui e clique em “Verificar conexão e continuar”.');
            return;
          }
          setCompleting(false);
          toast.error(trialPayload?.message ?? 'A configuração terminou, mas não foi possível iniciar o teste. Tente confirmar novamente.');
          return;
        }
        if (trialPayload?.trialEndsAt) {
          trialDurationDays = Math.max(1, Math.ceil((new Date(trialPayload.trialEndsAt).getTime() - Date.now()) / 86_400_000));
        }
      }
      setProvisioningPending(false);

      await updateSession().catch(() => undefined);

      if (isExternalAsaasMode) {
        toast.success(needsSpecialist
          ? 'Perfil confirmado. Converse com um especialista antes de iniciar o período de teste.'
          : `Perfil confirmado. Seu teste grátis de ${trialDurationDays} dias começou sem cartão e sem cobrança automática.`);
        router.replace('/dashboard');
        return;
      }

      if (result.provisioningStatus === 'QUEUED') {
        toast.info(needsSpecialist
          ? 'Perfil confirmado. Converse com um especialista antes de iniciar o período de teste.'
          : `Sua conta financeira está pronta e o teste grátis de ${trialDurationDays} dias começou sem cartão e sem cobrança automática.`);
      } else {
        toast.success(needsSpecialist
          ? 'Conta financeira confirmada. Fale com um especialista para definir a condição comercial.'
          : `Conta financeira confirmada. Seu teste grátis de ${trialDurationDays} dias começou sem cartão e sem cobrança automática.`);
      }

      router.replace('/dashboard');
    } catch (error) {
      setCompleting(false);
      toast.error(extractError(error, 'Nao foi possivel confirmar a criacao da conta.'));
    } finally {
      setSaving(false);
    }
  }, [acceptedSelectionMatches, conditionAccepted, draft.incomeValue, goToStep, invitationCondition, isExternalAsaasMode, needsSpecialist, router, selectedMonthlyAmountCents, selectedPlanCode, studentCount, updateSession]);

  if (completing) {
    return <AlusaLogoLoader fullScreen />;
  }

  if (loading) {
    return (
      <FinanceWizardShell currentStep={1} direction={transitionDirection} footer={null}>
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
          disabled={saving}
          className="h-11 rounded-md px-5 text-sm font-semibold text-[#6f6878] shadow-none hover:bg-[#f5f2f8] hover:text-[#211b27]"
        >
          Voltar
        </Button>
      ) : null}
      {currentStep === 4 && isCustomInvitation && !needsSpecialist ? (
        <a className="text-sm font-semibold text-[#55298a] underline underline-offset-4 hover:text-[#4a2379]" href="mailto:contato@alusa.app">
          Fale com um especialista para pedir um ajuste
        </a>
      ) : null}
      {currentStep === 4 && needsSpecialist ? (
        <a className="text-sm font-semibold text-[#55298a] underline underline-offset-4 hover:text-[#4a2379]" href="mailto:contato@alusa.app">
          Fale com um especialista
        </a>
      ) : (
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
                    ? () => goToStep(5)
                    : handleCompleteWizard
          }
          disabled={saving}
          className="h-11 w-[151px] rounded-md bg-[#55298a] text-sm font-semibold text-white shadow-none transition hover:bg-[#4a2379] disabled:bg-[#d7d0df] disabled:text-white"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : currentStep === 5 ? provisioningPending ? 'Verificar conexão e continuar' : 'Confirmar' : 'Continuar'}
        </Button>
      )}
    </>
  );

  return (
    <FinanceWizardShell currentStep={currentStep} direction={transitionDirection} footer={footer}>
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

            {!isExternalAsaasMode ? (
              <>
                <Field label="E-mail da subconta Asaas">
                  <Input
                    type="email"
                    autoComplete="email"
                    value={draft.subaccountEmail}
                    onChange={(event) => updateDraft('subaccountEmail', event.target.value)}
                    placeholder="financeiro@suaescola.com.br"
                    className={FIELD_CLASS}
                  />
                </Field>
                <p className="-mt-4 text-xs leading-5 text-[#6f6878]">
                  Se o Asaas informar que este e-mail já está em uso, volte aqui e informe outro endereço.
                  Se deixar em branco, usaremos o e-mail da sua conta Alusa.
                </p>
              </>
            ) : null}

            <Field label="Faturamento mensal (R$) *">
              <Input
                value={draft.incomeValue}
                onChange={(event) => updateDraft('incomeValue', formatMoneyInput(event.target.value))}
                placeholder="R$ 0,00"
                inputMode="numeric"
                className={cn(FIELD_CLASS, 'financial-data')}
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
        <div className="w-full max-w-[920px] pb-8">
          <h1 className="max-w-[560px] text-xl leading-6 text-[#17121c]">
            <span className="font-semibold">Quantos alunos sua escola tem hoje?</span>
          </h1>
          <p className="mt-3 max-w-[600px] text-sm leading-6 text-[#6f6878]">
            Todos os recursos da Alusa em um único plano, com mensalidade definida pela quantidade de alunos.
          </p>

          <section
            className="mt-6 grid overflow-hidden rounded-lg border border-[#e3ddea] bg-white md:grid-cols-2"
            aria-label="Simulador de mensalidade"
          >
            <div className="grid content-center gap-4 p-5 sm:p-7">
              <div>
                <p className="text-base font-semibold text-[#17121c]">{isCustomInvitation ? 'Condição comercial acordada' : 'Alunos pagantes'}</p>
                <p id="finance-student-count-help" className="mt-1 text-sm leading-5 text-[#6f6878]">
                  {isCustomInvitation ? 'Esta condição personalizada permanece fixa e não é recalculada pela faixa padrão.' : `${invitationCondition?.conditionType === 'STANDARD' ? 'A faixa inicial do convite é uma estimativa ajustável. Selecione a quantidade atual da escola; o onboarding recalcula a faixa e o valor para sua confirmação antes do trial ou Checkout. ' : ''}Conte cada aluno uma vez, mesmo que tenha várias matrículas. Inclua bolsas parciais e mensalidades em atraso. Não inclua alunos que tenham apenas bolsa integral.`}
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <output htmlFor="finance-student-count" className="text-4xl font-semibold tracking-tight text-[#17121c]">
                  {studentCount}
                </output>
                <span className="text-sm text-[#6f6878]">alunos</span>
              </div>
              {!isCustomInvitation ? <input
                id="finance-student-count"
                type="range"
                min={1}
                max={501}
                step={1}
                value={studentCount}
                aria-label="Alunos pagantes"
                onChange={(event) => {
                  const nextCount = Number(event.target.value);
                  setStudentCount(nextCount);
                  if (invitationCondition) setConditionAccepted(invitationCondition.acceptedCurrentVersion && invitationCondition.acceptedStudentCount === nextCount);
                }}
                aria-describedby="finance-student-count-help"
                aria-valuetext={`${studentCount} alunos`}
                style={{
                  '--pricing-range-progress': `${((Math.min(studentCount, 500) - 1) / 499) * 100}%`,
                  height: 8,
                  margin: 0,
                } as React.CSSProperties}
                className="pricing-range focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#55298a]"
              /> : null}
              {!isCustomInvitation ? <div className="flex justify-between text-xs text-[#7b7484]" aria-hidden="true">
                <span>1 aluno</span>
                <span>500+ alunos</span>
              </div> : null}
            </div>

            <div className="grid content-center gap-4 border-t border-[#e3ddea] bg-[#fbfafd] p-5 sm:p-7 md:border-l md:border-t-0">
              <div>
                <p className="text-sm font-semibold text-[#6f6878]">{needsSpecialist ? 'Mais de 500 alunos' : selectedTier?.label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-[#17121c]" aria-hidden="true">
                  <span className="inline-flex items-baseline tabular-nums">
                    {selectedTier ? <><span className="mr-[0.12em]">R$</span><span><SlidingNumber value={selectedTier.price} />,00</span></> : <span>{monthlyPrice}</span>}
                    <span className="ml-1 text-sm font-medium text-[#6f6878]">/mês</span>
                  </span>
                </p>
                <span className="sr-only" aria-live="polite" aria-atomic="true">
                  {needsSpecialist ? 'Mais de 500 alunos, condição personalizada.' : `${isCustomInvitation ? 'Condição comercial personalizada' : selectedTier?.label}, ${monthlyPrice} por mês.`}
                </span>
              </div>
              <div>
                <p className="font-semibold text-[#211b27]">Todos os módulos essenciais incluídos.</p>
                <p className="mt-1 text-sm leading-5 text-[#6f6878]">
                  {isCustomInvitation ? 'Condição fixa acordada para sua escola.' : 'O valor só muda após 3 meses consecutivos em outra faixa.'}
                </p>
              </div>
              <div className="rounded-md bg-[#f0e7fa] p-3 text-sm leading-5 text-[#4d4557]">
                <p>{trialDays > 0 ? <><strong>{trialDays} dias grátis, sem cartão.</strong> Sem cobrança automática. Ao final do período, você decide se quer contratar.</> : <><strong>Sem período de teste.</strong> Depois da configuração, você confirma a assinatura pelo Checkout Stripe.</>}</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {currentStep === 5 ? (
        <div className="w-full max-w-[760px] pb-8">
          <h1 className="max-w-[560px] text-xl leading-6 text-[#17121c]">
            <span className="font-semibold">Revise os dados antes de confirmar.</span> Depois disso,
            vamos continuar a configuração financeira da escola.
          </h1>
          <p className="mt-3 max-w-[600px] text-sm leading-6 text-[#6f6878]">
            {isExternalAsaasMode
              ? 'Como você já usa uma conta de pagamentos, a Alusa vai confirmar o perfil e seguir para a conexão segura dessa conta.'
              : 'A equipe continuará a configuração da conta de pagamentos vinculada à escola após a confirmação dos dados.'}
          </p>
          {provisioningPending ? (
            <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <p className="font-semibold">A conexão financeira ainda está em andamento.</p>
              <p>O teste grátis ainda não começou. Você pode sair e voltar a este wizard; quando a conta Asaas estiver conectada, use “Verificar conexão e continuar” para iniciar o teste.</p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4">
            <ReviewSection title="Resumo do plano">
              <SummaryItem label="Alunos na simulação" value={<span className="financial-data">{studentCount}</span>} />
              <SummaryItem label="Faixa escolhida" value={needsSpecialist ? 'Mais de 500 alunos' : selectedTier?.label ?? 'Sem alunos informados'} />
              <SummaryItem label="Mensalidade" value={<span className="financial-data">{monthlyPrice}</span>} />
              <SummaryItem label="Período de teste" value={trialDays > 0 ? `${trialDays} dias grátis, sem cartão e sem cobrança automática` : 'Sem teste grátis'} />
            </ReviewSection>

            {invitationCondition ? <section className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-[#4d4557]">
              <p className="font-semibold">Condição comercial · versão {invitationCondition.currentConditionVersion}</p>
              <p>{isCustomInvitation ? `Valor base de ${((invitationCondition.customBaseMonthlyAmountCents ?? invitationCondition.monthlyAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, inclui ${invitationCondition.customIncludedStudentCount ?? studentCount} alunos e acrescenta ${((invitationCondition.customMonthlyOverageAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por aluno acima do limite. No momento, a mensalidade estimada é ${monthlyPrice}.` : `Estimativa ajustável de ${studentCount} alunos · ${selectedTier?.label ?? 'faixa especial'} · ${monthlyPrice} por mês`}; {trialDays > 0 ? `teste de ${trialDays} dias, iniciado após concluir a configuração` : 'sem período de teste'}.</p>
              <label className="mt-3 flex items-start gap-2 font-medium"><input type="checkbox" checked={conditionAccepted} onChange={(event) => setConditionAccepted(event.target.checked)} className="mt-1" /><span>Li e aceito a condição comercial desta versão. O teste não gera cobrança automática; uma contratação posterior exige confirmação.</span></label>
            </section> : null}

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
              {!isExternalAsaasMode ? <SummaryItem label="E-mail financeiro" value={draft.subaccountEmail} /> : null}
              <SummaryItem label="Faturamento mensal" value={<span className="financial-data">{draft.incomeValue}</span>} />
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
          </div>
        </div>
      ) : null}
    </FinanceWizardShell>
  );
}
