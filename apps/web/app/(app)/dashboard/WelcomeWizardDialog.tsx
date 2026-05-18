'use client';

import Image from 'next/image';
import { useState } from 'react';

import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type WelcomeWizardDialogProps = {
  open: boolean;
  userName?: string | null;
  onComplete: () => Promise<void>;
};

type WelcomeStep = {
  title: string;
  description: string;
  imageHint: string;
  imageSrc?: string;
};

const WELCOME_STEPS: WelcomeStep[] = [
  {
    title: 'Sua operação começa aqui',
    description:
      'A Alusa reúne a rotina acadêmica e financeira da sua escola em um painel único, claro e pronto para o dia a dia.',
    imageHint: 'Espaço para imagem de boas-vindas',
    imageSrc: '/images/welcome-wizard/welcome-dashboard.jpg',
  },
  {
    title: 'Organize sua base com clareza',
    description:
      'Cadastros, turmas e responsáveis ficam conectados para você começar a operar sem ruído.',
    imageHint: 'Espaço para imagem de cadastros',
  },
  {
    title: 'Acompanhe a rotina da escola',
    description:
      'Agenda, aulas e operação diária aparecem no mesmo fluxo para facilitar a leitura do time.',
    imageHint: 'Espaço para imagem de agenda e operação',
  },
  {
    title: 'Visualize o financeiro com contexto',
    description:
      'Cobranças, recebimentos e acompanhamento ficam visíveis dentro do painel sem excesso de informação.',
    imageHint: 'Espaço para imagem do financeiro',
  },
  {
    title: 'Tudo pronto para começar',
    description:
      'Use o dashboard como ponto de partida da operação e ajuste o restante conforme a escola evoluir.',
    imageHint: 'Espaço para imagem final do dashboard',
  },
];

export function WelcomeWizardDialog({ open, userName: _userName, onComplete }: WelcomeWizardDialogProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const step = WELCOME_STEPS[stepIndex];
  const isLastStep = stepIndex === WELCOME_STEPS.length - 1;

  const handleAdvance = async () => {
    if (!isLastStep) {
      setDirection(1);
      setStepIndex((current) => current + 1);
      return;
    }

    try {
      setSubmitting(true);
      await onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setDirection(-1);
    setStepIndex((current) => Math.max(0, current - 1));
  };

  return (
    <Dialog open={open}>
      <DialogContent
        fullScreenMobile
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-w-[720px] overflow-hidden rounded-[28px] sm:rounded-[28px] border border-[#ebe3fb] bg-white p-0 shadow-[0_20px_60px_rgba(0,0,0,0.22),0_4px_16px_rgba(0,0,0,0.08)] [&>button.absolute]:hidden"
      >
        <div className="flex min-h-[560px] select-none flex-col overflow-hidden rounded-[28px] bg-white px-5 py-5 sm:px-6 sm:py-6">
          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={stepIndex}
                custom={direction}
                initial={{ x: direction * 60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: direction * -60, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              >
                <div className="relative aspect-[16/8.8] overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_top,rgba(123,86,184,0.18),transparent_52%),linear-gradient(135deg,#f8f4ff_0%,#f2ebff_52%,#efe8ff_100%)]">
                  {step.imageSrc ? (
                    <Image
                      src={step.imageSrc}
                      alt={step.title}
                      fill
                      priority={stepIndex === 0}
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 720px"
                    />
                  ) : (
                    <>
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_40%,rgba(91,47,167,0.06)_100%)]" />
                      <div className="absolute inset-0 flex items-center justify-center text-center">
                        <div className="space-y-1 px-6">
                          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#7b56b8]">
                            imagem
                          </p>
                          <p className="text-sm text-slate-500/90">{step.imageHint}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <DialogHeader className="mt-5 items-center space-y-0 text-center sm:mt-6">
                  <DialogTitle className="max-w-none whitespace-nowrap text-center text-[1.55rem] font-semibold leading-[1.08] tracking-[-0.03em] text-slate-900 sm:text-[1.8rem]">
                    {stepIndex === 0 ? 'Seja bem-vindo(a) à Alusa!' : step.title}
                  </DialogTitle>

                  <DialogDescription className="max-w-[44ch] pt-3 pb-6 text-center text-[15px] leading-7 text-slate-500 sm:text-base">
                    {step.description}
                  </DialogDescription>
                </DialogHeader>
              </motion.div>
            </AnimatePresence>
          </div>

          <DialogFooter className="mt-auto w-full pt-5 sm:justify-center">
            <div className="flex w-full items-center justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={stepIndex === 0 || submitting}
                className="h-10 min-w-[112px] border-[#e8defa] px-4 text-slate-500 hover:bg-[#f8f4ff]"
              >
                Voltar
              </Button>

              <Button
                type="button"
                onClick={() => void handleAdvance()}
                disabled={submitting}
                className="h-10 min-w-[112px] bg-brand-accent px-5 text-white hover:bg-brand-accent/90"
              >
                {isLastStep ? 'Ir para o dashboard' : 'Avançar'}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WelcomeWizardDialog;