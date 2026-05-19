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
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';

interface ActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  loadingLabel?: string;
  onConfirm: (motivo: string) => Promise<void>;
  motivoRequired?: boolean;
  motivoLabel?: string;
  motivoPlaceholder?: string;
  variant?: 'danger' | 'warning' | 'default';
}

const controlClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 resize-none';

export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  loadingLabel = 'Processando...',
  onConfirm,
  motivoRequired = false,
  motivoLabel = 'Motivo',
  motivoPlaceholder = 'Descreva o motivo desta ação...',
  variant = 'default',
}: ActionDialogProps) {
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (motivoRequired && !motivo.trim()) {
      return;
    }

    try {
      setLoading(true);
      await onConfirm(motivo.trim());
      setMotivo('');
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in the parent component
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setMotivo('');
    onOpenChange(false);
  };

  const getButtonClass = () => {
    if (variant === 'danger') {
      return 'bg-red-600 hover:bg-red-700 text-white';
    }
    if (variant === 'warning') {
      return 'bg-orange-600 hover:bg-orange-700 text-white';
    }
    return 'bg-[#A94DFF] hover:bg-[#A94DFF]/90 text-white';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="motivo" className="text-xs font-medium text-slate-600">
              {motivoLabel} {motivoRequired && <span className="text-red-500">*</span>}
            </Label>
            <textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={motivoPlaceholder}
              rows={4}
              className={controlClass}
              disabled={loading}
            />
            {motivoRequired && (
              <p className="text-xs text-slate-500">
                {motivoRequired ? 'Campo obrigatório' : 'Campo opcional - ajuda no controle de desistências'}
              </p>
            )}
          </div>

          <InfoCallout size="sm">
            <InfoCalloutItem label="Importante" labelTone="default">
              Este motivo será registrado no histórico da matrícula para fins de auditoria e análise de
              desistências.
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
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading || (motivoRequired && !motivo.trim())}
            className={getButtonClass()}
          >
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


