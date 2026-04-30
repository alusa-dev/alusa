'use client';

import { useState } from 'react';
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
import { Switch } from '@/components/ui/switch';

export interface PausarMatriculaPayload {
  motivoPausa: string;
  dataInicioPausa: string;
  dataRetornoPrevista?: string;
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  observacao?: string;
}

interface PausarMatriculaDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  alunoNome: string;
  onConfirm: (_payload: PausarMatriculaPayload) => Promise<void>;
}

const controlClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function PausarMatriculaDialog({
  open,
  onOpenChange,
  alunoNome,
  onConfirm,
}: PausarMatriculaDialogProps) {
  const [motivoPausa, setMotivoPausa] = useState('');
  const [dataInicioPausa, setDataInicioPausa] = useState(todayISO());
  const [dataRetornoPrevista, setDataRetornoPrevista] = useState('');
  const [manterVaga, setManterVaga] = useState(true);
  const [cobrarDurantePausa, setCobrarDurantePausa] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = motivoPausa.trim().length > 0 && dataInicioPausa.length > 0;

  const reset = () => {
    setMotivoPausa('');
    setDataInicioPausa(todayISO());
    setDataRetornoPrevista('');
    setManterVaga(true);
    setCobrarDurantePausa(false);
    setObservacao('');
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    try {
      setLoading(true);
      await onConfirm({
        motivoPausa: motivoPausa.trim(),
        dataInicioPausa,
        dataRetornoPrevista: dataRetornoPrevista || undefined,
        manterVaga,
        cobrarDurantePausa,
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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Pausar matrícula
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Pausar a matrícula de <strong>{alunoNome}</strong>. A assinatura será
            inativada no sistema financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Motivo */}
          <div className="space-y-1.5">
            <Label htmlFor="pausaMotivo" className="text-xs font-medium text-slate-600">
              Motivo da pausa <span className="text-red-500">*</span>
            </Label>
            <textarea
              id="pausaMotivo"
              value={motivoPausa}
              onChange={(e) => setMotivoPausa(e.target.value)}
              placeholder="Ex: Problema de saúde, viagem, questões financeiras..."
              rows={3}
              className={`${controlClass} resize-none`}
              disabled={loading}
            />
          </div>

          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pausaInicio" className="text-xs font-medium text-slate-600">
                Início da pausa <span className="text-red-500">*</span>
              </Label>
              <input
                id="pausaInicio"
                type="date"
                value={dataInicioPausa}
                onChange={(e) => setDataInicioPausa(e.target.value)}
                className={controlClass}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pausaRetorno" className="text-xs font-medium text-slate-600">
                Retorno previsto
              </Label>
              <input
                id="pausaRetorno"
                type="date"
                value={dataRetornoPrevista}
                onChange={(e) => setDataRetornoPrevista(e.target.value)}
                min={dataInicioPausa}
                className={controlClass}
                disabled={loading}
              />
            </div>
          </div>

          {/* Switches */}
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Manter vaga reservada</p>
                <p className="text-xs text-slate-500">
                  Se desligado, a vaga será liberada e pode ser ocupada por outro aluno.
                </p>
              </div>
              <Switch checked={manterVaga} onCheckedChange={setManterVaga} disabled={loading} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Cobrar durante a pausa</p>
                <p className="text-xs text-slate-500">
                  Se ligado, as cobranças continuam sendo geradas normalmente.
                </p>
              </div>
              <Switch
                checked={cobrarDurantePausa}
                onCheckedChange={setCobrarDurantePausa}
                disabled={loading}
              />
            </div>
          </div>

          {/* Observação */}
          <div className="space-y-1.5">
            <Label htmlFor="pausaObs" className="text-xs font-medium text-slate-600">
              Observação interna
            </Label>
            <textarea
              id="pausaObs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Visível apenas para a equipe administrativa..."
              rows={2}
              className={`${controlClass} resize-none`}
              disabled={loading}
            />
          </div>

          {/* Info */}
          {!manterVaga && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-800">
                <strong>Atenção:</strong> Ao liberar a vaga, outro aluno poderá ocupar essa posição.
                Na reativação, será necessário haver capacidade disponível na turma.
              </p>
            </div>
          )}
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
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {loading ? 'Pausando...' : 'Pausar matrícula'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
