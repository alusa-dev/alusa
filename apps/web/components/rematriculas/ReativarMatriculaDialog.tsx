'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoCircle } from '@/components/icons/icons';

export interface ReativarMatriculaPayload {
  dataRetornoEfetiva: string;
  nextDueDate: string;
  observacao?: string;
}

interface ReativarMatriculaDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  alunoNome: string;
  vencimentoDia?: number | null;
  isSharedSubscription?: boolean;
  onConfirm: (_payload: ReativarMatriculaPayload) => Promise<void>;
}

const controlClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function computeNextDueDate(referenceDate: string, vencimentoDia?: number | null): string {
  const [yearStr, monthStr, dayStr] = referenceDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!year || !month || !day) {
    return todayISO();
  }

  const billingDay = Math.min(Math.max(vencimentoDia ?? 1, 1), 31);
  const currentMonthDueDay = Math.min(billingDay, getDaysInMonth(year, month));

  if (currentMonthDueDay >= day) {
    return formatIsoDate(year, month, currentMonthDueDay);
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthDueDay = Math.min(billingDay, getDaysInMonth(nextYear, nextMonth));
  return formatIsoDate(nextYear, nextMonth, nextMonthDueDay);
}

export function ReativarMatriculaDialog({
  open,
  onOpenChange,
  alunoNome,
  vencimentoDia,
  isSharedSubscription = false,
  onConfirm,
}: ReativarMatriculaDialogProps) {
  const [dataRetornoEfetiva, setDataRetornoEfetiva] = useState(todayISO());
  const [nextDueDate, setNextDueDate] = useState(computeNextDueDate(todayISO(), vencimentoDia));
  const [observacao, setObservacao] = useState('');
  const [loading, setLoading] = useState(false);
  const [nextDueDateEdited, setNextDueDateEdited] = useState(false);

  const canSubmit = dataRetornoEfetiva.length > 0 && nextDueDate.length > 0;

  const reset = () => {
    const initialReturnDate = todayISO();
    setDataRetornoEfetiva(initialReturnDate);
    setNextDueDate(computeNextDueDate(initialReturnDate, vencimentoDia));
    setObservacao('');
    setNextDueDateEdited(false);
  };

  useEffect(() => {
    if (!open) return;
    const initialReturnDate = todayISO();
    setDataRetornoEfetiva(initialReturnDate);
    setNextDueDate(computeNextDueDate(initialReturnDate, vencimentoDia));
    setObservacao('');
    setNextDueDateEdited(false);
  }, [open, vencimentoDia]);

  useEffect(() => {
    if (!open || nextDueDateEdited) return;
    setNextDueDate(computeNextDueDate(dataRetornoEfetiva, vencimentoDia));
  }, [dataRetornoEfetiva, nextDueDateEdited, open, vencimentoDia]);

  const handleConfirm = async () => {
    if (!canSubmit) return;
    try {
      setLoading(true);
      await onConfirm({
        dataRetornoEfetiva,
        nextDueDate,
        observacao: observacao.trim() || undefined,
      });
      reset();
      onOpenChange(false);
    } catch {
      // erro tratado pelo caller
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Reativar matrícula
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {isSharedSubscription
              ? <>Reativar a matrícula de <strong>{alunoNome}</strong> e incluí-la novamente na cobrança compartilhada.</>
              : <>Reativar a matrícula de <strong>{alunoNome}</strong> e retomar sua cobrança recorrente.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex h-5 items-center">
                <Label htmlFor="reativarRetorno" className="text-xs font-medium leading-5 text-slate-600">
                  Data de retorno <span className="text-red-500">*</span>
                </Label>
              </div>
              <input
                id="reativarRetorno"
                type="date"
                value={dataRetornoEfetiva}
                onChange={(e) => setDataRetornoEfetiva(e.target.value)}
                className={controlClass}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex h-5 items-center gap-1">
                <Label htmlFor="reativarDueDate" className="text-xs font-medium leading-5 text-slate-600">
                  Próximo vencimento <span className="text-red-500">*</span>
                </Label>
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Sobre o próximo vencimento"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30"
                        disabled={loading}
                      >
                        <InfoCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Vencimento da próxima mensalidade a ser gerada.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <input
                id="reativarDueDate"
                type="date"
                value={nextDueDate}
                onChange={(e) => {
                  setNextDueDate(e.target.value);
                  setNextDueDateEdited(true);
                }}
                min={dataRetornoEfetiva || todayISO()}
                className={controlClass}
                disabled={loading}
              />
            </div>
          </div>

          {/* Observação */}
          <div className="space-y-1.5">
            <Label htmlFor="reativarObs" className="text-xs font-medium text-slate-600">
              Observação interna
            </Label>
            <textarea
              id="reativarObs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Retorno após tratamento, retorno de viagem..."
              rows={2}
              className={`${controlClass} resize-none`}
              disabled={loading}
            />
          </div>

          {/* Info */}
          <InfoCallout variant="info" size="sm" showIcon={false}>
            <InfoCalloutItem label="Importante">
              {isSharedSubscription
                ? 'A matrícula voltará a participar da cobrança compartilhada. A data informada e o total das próximas mensalidades serão aplicados a todas as matrículas vinculadas.'
                : 'A cobrança recorrente será retomada usando a data informada para a próxima mensalidade.'}{' '}
              Cobranças já emitidas não terão o vencimento alterado.
            </InfoCalloutItem>
          </InfoCallout>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
            className="border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !canSubmit}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {loading ? 'Reativando...' : 'Reativar matrícula'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
