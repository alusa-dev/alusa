"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from '@/components/ui/toast';
import { Building2, User, Check, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
// signOut/X moved to AuthPageContainer

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import AuthShell from '@/components/auth/AuthShell';
import AuthPageContainer from '@/components/auth/AuthPageContainer';

import type { WizardState, WizardStep } from '@alusa/finance/wizard-client';
import {
  getWizardState,
  saveWizardStep1,
  completeWizard,
  WizardApiError,
} from './wizard-service';

import { WizardStep2IdentificationForm } from './WizardStep2IdentificationForm';
import { WizardStep3ContactForm } from './WizardStep3ContactForm';
import { WizardStep4AddressForm } from './WizardStep4AddressForm';
import { WizardStep5FinancialForm } from './WizardStep5FinancialForm';

type PersonType = 'PF' | 'PJ';

const STEP_TITLES: Record<WizardStep, string> = {
  0: 'Bem-vindo',
  1: 'Tipo de Conta',
  2: 'Identificação',
  3: 'Contato',
  4: 'Endereço',
  5: 'Informações Financeiras',
  6: 'Conclusão',
};

const STEP_DESCRIPTIONS: Record<WizardStep, string> = {
  0: 'Configure seu perfil financeiro para começar a receber pagamentos.',
  1: 'Escolha se você é pessoa física ou jurídica.',
  2: 'Informe os dados de identificação.',
  3: 'Compartilhe seus canais de contato.',
  4: 'Informe seu endereço.',
  5: 'Informe seu faturamento mensal.',
  6: 'Finalize o wizard quando estiver pronto.',
};

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 20 : -20,
    opacity: 0,
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 20 : -20,
    opacity: 0,
  }),
};

export function FinanceWizard() {
  const router = useRouter();
  const { update: updateSession } = useSession();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [direction, setDirection] = useState(0);
  const [selectedPersonType, setSelectedPersonType] = useState<PersonType | null>(null);

  // Load wizard state
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        const result = await getWizardState(controller.signal);
        setWizardState(result.wizard);
        const normalizedStep = result.wizard.step && result.wizard.step > 0 ? result.wizard.step : 1;
        setCurrentStep(normalizedStep as WizardStep);
        setSelectedPersonType(result.wizard.personType);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error(error);
        toast.error('Não foi possível carregar o wizard.');
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  const progressValue = (currentStep / 6) * 100;

  // Step 1
  const handleSelectPersonType = useCallback(async (type: PersonType) => {
    try {
      setSaving(true);
      setSelectedPersonType(type);

      const result = await saveWizardStep1({ personType: type });
      setDirection(1);
      setWizardState(result.wizard);
      setCurrentStep(result.nextStep);
    } catch (error) {
      const message =
        error instanceof WizardApiError
          ? error.message
          : 'Erro ao salvar tipo de conta.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleStepComplete = useCallback(
    (newState: WizardState, nextStep: WizardStep) => {
      setDirection(nextStep > currentStep ? 1 : -1);
      setWizardState(newState);
      setCurrentStep(nextStep);
    },
    [currentStep]
  );

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setDirection(-1);
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  }, [currentStep]);

  const handleCompleteWizard = useCallback(async () => {
    try {
      setSaving(true);
      const result = await completeWizard();
      setDirection(1);
      setWizardState(result.wizard);
      setCurrentStep(6);

      if (result.success) {
        if (result.provisioningStatus === 'QUEUED') {
          toast.info(
            'Estamos criando sua conta de pagamentos. Em geral leva poucos minutos — você pode continuar usando o app.',
          );
        }
        await updateSession().catch((error) => {
          console.warn('[FinanceWizard] Falha ao atualizar sessão após conclusão', error);
        });
        router.refresh();
        router.replace('/dashboard');
      } else {
        toast.error(result.error?.message || 'Não foi possível concluir o cadastro financeiro.');
      }
    } catch (error) {
      const message =
        error instanceof WizardApiError
          ? error.message
          : 'Não foi possível concluir o cadastro financeiro.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [router, updateSession]);

  if (loading) {
    return (
      <AuthPageContainer>
        <div className="flex min-h-screen items-center justify-center w-full">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AuthPageContainer>
    );
  }

  return (
    <AuthPageContainer showClose>
      <AuthShell>
        <div className="relative flex h-full w-full flex-col overflow-hidden">
          <div className="flex flex-col gap-6 px-8 pt-8">
            {/* Progress */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Passo {currentStep} de 6
                </p>
                <span className="text-xs text-muted-foreground">
                  {Math.round(progressValue)}% completo
                </span>
              </div>
              <Progress value={progressValue} className="h-2 rounded-full bg-gray-100" />
            </div>

            {/* Title */}
            {currentStep !== 6 && (
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                  {STEP_TITLES[currentStep]}
                </h1>
                <p className="text-base text-gray-500">
                  {STEP_DESCRIPTIONS[currentStep]}
                </p>
              </div>
            )}
          </div>

          {/* Step container */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="flex flex-1 flex-col px-8 pb-24 pt-6"
            >
                {currentStep === 1 && (
              <div className="flex flex-col gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => handleSelectPersonType('PF')}
                  disabled={saving}
                  className={cn(
                    'group flex flex-col items-center gap-3 rounded-xl border-2 bg-white p-6 text-left transition-all hover:border-primary/50 hover:bg-gray-50 hover:shadow-sm',
                    selectedPersonType === 'PF' ? 'border-primary bg-primary/5' : 'border-gray-100',
                    saving && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <div className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                    selectedPersonType === 'PF' ? "bg-primary text-white" : "bg-gray-100 text-gray-500 group-hover:bg-primary/10 group-hover:text-primary"
                  )}>
                    <User className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-gray-900">Pessoa Física</p>
                    <p className="text-sm text-gray-500">Para quem possui CPF</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectPersonType('PJ')}
                  disabled={saving}
                  className={cn(
                    'group flex flex-col items-center gap-3 rounded-xl border-2 bg-white p-6 text-left transition-all hover:border-primary/50 hover:bg-gray-50 hover:shadow-sm',
                    selectedPersonType === 'PJ' ? 'border-primary bg-primary/5' : 'border-gray-100',
                    saving && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <div className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                    selectedPersonType === 'PJ' ? "bg-primary text-white" : "bg-gray-100 text-gray-500 group-hover:bg-primary/10 group-hover:text-primary"
                  )}>
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-gray-900">Pessoa Jurídica</p>
                    <p className="text-sm text-gray-500">Para quem possui CNPJ</p>
                  </div>
                </button>
              </div>
            )}

            {currentStep === 2 && wizardState && (
              <WizardStep2IdentificationForm
                wizardState={wizardState}
                onComplete={handleStepComplete}
                onBack={handleBack}
              />
            )}

            {currentStep === 3 && wizardState && (
              <WizardStep3ContactForm
                wizardState={wizardState}
                onComplete={handleStepComplete}
                onBack={handleBack}
              />
            )}

            {currentStep === 4 && wizardState && (
              <WizardStep4AddressForm
                wizardState={wizardState}
                onComplete={handleStepComplete}
                onBack={handleBack}
              />
            )}

            {currentStep === 5 && wizardState && (
              <WizardStep5FinancialForm
                wizardState={wizardState}
                onComplete={handleStepComplete}
                onBack={handleBack}
              />
            )}

            {currentStep === 6 && (
              <div className="flex h-full flex-col">
                <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
                    <Check className="h-8 w-8 text-green-600" />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xl font-semibold text-gray-900">Tudo pronto!</p>
                    <p className="mx-auto max-w-sm text-base text-gray-500">
                      Seu perfil financeiro foi configurado com sucesso. Você já pode acessar o dashboard.
                    </p>
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 w-full px-8 pb-8 pt-6 flex justify-between bg-white z-10 rounded-b-2xl">
                  <Button 
                    variant="outline" 
                    onClick={handleBack}
                    className="h-10 px-6 text-sm border-gray-200 hover:bg-gray-50 hover:text-gray-900"
                  >
                    Voltar
                  </Button>
                  <Button 
                    onClick={handleCompleteWizard} 
                    disabled={saving}
                    className="h-10 px-8 text-sm shadow-sm hover:shadow-md transition-all"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Finalizando...
                      </>
                    ) : (
                      'Continuar'
                    )}
                  </Button>
                </div>
              </div>
            )}
              </motion.div>
            </AnimatePresence>
        </div>
      </AuthShell>
    </AuthPageContainer>
  );
}
