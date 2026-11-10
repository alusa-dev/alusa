'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getMatriculaPausaResumoRequest, type MatriculaPausaResumo } from '../services/enrollments-service';

interface PauseRegularizationDialogProps {
  open: boolean;
  matriculaId: string | null;
  alunoNome: string;
  submitting: boolean;
  canSubmit: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

export function PauseRegularizationDialog({
  open,
  matriculaId,
  alunoNome,
  submitting,
  canSubmit,
  onOpenChange,
  onConfirm,
}: PauseRegularizationDialogProps) {
  const [reason, setReason] = useState('');
  const [eligibility, setEligibility] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; summary: MatriculaPausaResumo }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  useEffect(() => {
    if (!open || !matriculaId) {
      setReason('');
      setEligibility({ status: 'idle' });
      return;
    }
    let current = true;
    setReason('');
    setEligibility({ status: 'loading' });
    void getMatriculaPausaResumoRequest(matriculaId).then((summary) => {
      if (current) setEligibility({ status: 'ready', summary });
    }).catch((error: unknown) => {
      if (current) setEligibility({
        status: 'error',
        message: error instanceof Error
          ? error.message
          : 'Não foi possível confirmar se o prazo e o contrato permitem a regularização. Atualize e tente novamente.',
      });
    });
    return () => { current = false; };
  }, [matriculaId, open]);

  const eligible = eligibility.status === 'ready' && eligibility.summary.regularizacaoPausa.elegivel;
  const eligibilityMessage = eligibility.status === 'loading'
    ? 'Verificando o prazo previsto e a vigência do contrato…'
    : eligibility.status === 'error'
      ? eligibility.message
      : eligibility.status === 'ready'
        ? eligibility.summary.regularizacaoPausa.mensagem ?? (
          eligibility.summary.regularizacaoPausa.elegivel
            ? 'O prazo venceu e o contrato está vigente. A justificativa pode ser enviada.'
            : 'A regularização ainda não está elegível. Confira a pausa e a vigência do contrato.'
        )
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Regularizar prazo da pausa</DialogTitle>
          <DialogDescription>
            Para {alunoNome}, envie a justificativa apenas quando a Alusa confirmar a elegibilidade abaixo. A regularização mantém a matrícula pausada; a retomada é uma decisão separada e não altera cobranças.
          </DialogDescription>
        </DialogHeader>
        {eligibilityMessage ? (
          <p role={eligibility.status === 'error' ? 'alert' : 'status'} className="rounded-md border bg-slate-50 p-3 text-sm text-slate-800">
            {eligibilityMessage}
          </p>
        ) : null}
        <div className="space-y-2">
          <label htmlFor="regularizar-pausa-motivo" className="text-sm font-medium">Justificativa</label>
          <Textarea
            id="regularizar-pausa-motivo"
            aria-label="Justificativa para regularizar o prazo da pausa"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={8}
            maxLength={1000}
            placeholder="Descreva a confirmação ou decisão da instituição."
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">Informe pelo menos 8 caracteres. A regularização não reativa a matrícula nem altera cobranças.</p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (eligible && canSubmit && reason.trim().length >= 8) void onConfirm(reason.trim());
            }}
            disabled={submitting || !canSubmit || !eligible || reason.trim().length < 8}
          >
            {submitting ? 'Salvando…' : 'Regularizar prazo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
