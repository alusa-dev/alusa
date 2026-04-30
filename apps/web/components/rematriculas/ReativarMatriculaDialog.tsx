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
            Reativar a matrícula de <strong>{alunoNome}</strong>. A assinatura será
            reativada no sistema financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reativarRetorno" className="text-xs font-medium text-slate-600">
                Data de retorno <span className="text-red-500">*</span>
              </Label>
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
              <Label htmlFor="reativarDueDate" className="text-xs font-medium text-slate-600">
                Próximo vencimento <span className="text-red-500">*</span>
              </Label>
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
              <p className="text-xs text-slate-500">
                Vencimento da próxima mensalidade a ser gerada.
              </p>
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
          <div className="rounded-lg bg-green-50 border border-green-200 p-3">
            <p className="text-xs text-green-800">
              <strong>Importante:</strong> A assinatura será reativada e a próxima cobrança
              gerada usará a data informada. Cobranças já geradas não têm o vencimento alterado
              por esta ação.
            </p>
          </div>
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
