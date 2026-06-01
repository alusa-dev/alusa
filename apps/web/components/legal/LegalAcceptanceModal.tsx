'use client';

import React, { useState, useEffect } from 'react';
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
import { legalPages } from '@/features/site/content/legal';
import { cn } from '@/lib/utils';

type LegalAcceptanceModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
};

export function LegalAcceptanceModal({ open, onOpenChange, onAccept }: LegalAcceptanceModalProps) {
  const [acceptedInside, setAcceptedInside] = useState(false);

  useEffect(() => {
    if (open) {
      setAcceptedInside(false);
    }
  }, [open]);

  function handleAccept() {
    if (!acceptedInside) return;
    onAccept();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        fullScreenMobile
        className="max-h-[70vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        data-sentry-mask
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left bg-slate-50">
          <DialogTitle className="text-xl font-bold text-[#2a1744]">Termos, privacidade e tratamento de dados</DialogTitle>
        </DialogHeader>

        <div
          className="min-h-0 overflow-y-auto px-8 py-6 space-y-8 scroll-smooth"
        >
          {/* Termos de Uso */}
          <section className="space-y-4">
            <h3 className="text-2xl font-bold text-[#2a1744] border-b border-slate-100 pb-2">
              1. {legalPages.termos.title}
            </h3>
            <p className="text-sm leading-relaxed text-slate-500 italic">
              {legalPages.termos.intro}
            </p>
            <div className="space-y-6">
              {legalPages.termos.sections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <h4 className="text-base font-semibold text-slate-900">{section.title}</h4>
                  <div className="space-y-2 text-sm leading-relaxed text-slate-600">
                    {section.body.map((p, idx) => (
                      <p key={idx}>{p}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Política de Privacidade */}
          <section className="space-y-4">
            <h3 className="text-2xl font-bold text-[#2a1744] border-b border-slate-100 pb-2">
              2. {legalPages.privacidade.title}
            </h3>
            <p className="text-sm leading-relaxed text-slate-500 italic">
              {legalPages.privacidade.intro}
            </p>
            <div className="space-y-6">
              {legalPages.privacidade.sections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <h4 className="text-base font-semibold text-slate-900">{section.title}</h4>
                  <div className="space-y-2 text-sm leading-relaxed text-slate-600">
                    {section.body.map((p, idx) => (
                      <p key={idx}>{p}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* DPA */}
          <section className="space-y-4">
            <h3 className="text-2xl font-bold text-[#2a1744] border-b border-slate-100 pb-2">
              3. {legalPages.dpa.title}
            </h3>
            <p className="text-sm leading-relaxed text-slate-500 italic">
              {legalPages.dpa.intro}
            </p>
            <div className="space-y-6">
              {legalPages.dpa.sections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <h4 className="text-base font-semibold text-slate-900">{section.title}</h4>
                  <div className="space-y-2 text-sm leading-relaxed text-slate-600">
                    {section.body.map((p, idx) => (
                      <p key={idx}>{p}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 flex-col sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 text-left">
            <label className="flex items-center gap-2.5 text-left text-sm font-medium transition-colors text-slate-700 cursor-pointer">
              <Checkbox
                checked={acceptedInside}
                onCheckedChange={(checked) => setAcceptedInside(!!checked)}
                data-testid="legal-acceptance-inner-checkbox"
              />
              <span>Li e aceito os documentos acima.</span>
            </label>
          </div>
          <div className="flex gap-2 justify-end mt-3 sm:mt-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              onClick={handleAccept}
              disabled={!acceptedInside}
              data-testid="legal-acceptance-confirm"
              className="bg-[#3e1f63] hover:bg-[#4b217a] text-white font-semibold transition-colors"
            >
              Aceitar e continuar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
