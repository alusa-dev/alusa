'use client';

import React, { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LegalDocumentTabs } from './LegalDocumentTabs';

type LegalAcceptanceModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
};

export function LegalAcceptanceModal({ open, onOpenChange, onAccept }: LegalAcceptanceModalProps) {
  const [acceptedInside, setAcceptedInside] = useState(false);

  function handleAccept() {
    if (!acceptedInside) return;
    onAccept();
    setAcceptedInside(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setAcceptedInside(false);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        fullScreenMobile
        className="max-h-[88vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        data-sentry-mask
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
          <DialogTitle>Termos, privacidade e tratamento de dados</DialogTitle>
          <DialogDescription>
            Leia os documentos aplicaveis ao cadastro da escola na Alusa antes de continuar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <LegalDocumentTabs />
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Versoes completas: <Link className="text-brand-accent underline" href="/termos" target="_blank">Termos de Uso</Link>,{' '}
            <Link className="text-brand-accent underline" href="/privacidade" target="_blank">Politica de Privacidade</Link>,{' '}
            <Link className="text-brand-accent underline" href="/dpa" target="_blank">DPA</Link> e{' '}
            <Link className="text-brand-accent underline" href="/seguranca" target="_blank">Seguranca</Link>.
          </p>
        </div>

        <DialogFooter className="gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-col sm:space-x-0">
          <label className="flex cursor-pointer items-start gap-3 text-left text-sm text-slate-700">
            <Checkbox
              checked={acceptedInside}
              onCheckedChange={setAcceptedInside}
              className="mt-0.5"
              data-testid="legal-acceptance-inner-checkbox"
            />
            <span>Li e aceito os documentos acima.</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              onClick={handleAccept}
              disabled={!acceptedInside}
              data-testid="legal-acceptance-confirm"
            >
              Aceitar e continuar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
