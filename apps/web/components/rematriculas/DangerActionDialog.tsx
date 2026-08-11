'use client';

import { useState, useCallback } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';

interface DangerActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loadingLabel: string;
  onConfirm: (motivo: string) => Promise<void>;
  motivoRequired?: boolean;
  motivoLabel?: string;
  motivoPlaceholder?: string;
  confirmationText: string; // Ex: "EXCLUIR"
  confirmationLabel?: string; // Ex: "Digite EXCLUIR para confirmar"
}

export function DangerActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loadingLabel,
  onConfirm,
  motivoRequired = true,
  motivoLabel = 'Motivo',
  motivoPlaceholder,
  confirmationText,
  confirmationLabel = `Digite ${confirmationText} para confirmar`,
}: DangerActionDialogProps) {
  const [motivo, setMotivo] = useState('');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (motivoRequired && !motivo.trim()) {
      setError('O motivo é obrigatório');
      return;
    }

    if (typedConfirmation !== confirmationText) {
      setError(`Você deve digitar exatamente "${confirmationText}" para confirmar`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onConfirm(motivo);
      // Reset state
      setMotivo('');
      setTypedConfirmation('');
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || 'Erro ao executar ação');
    } finally {
      setIsLoading(false);
    }
  }, [motivo, typedConfirmation, confirmationText, motivoRequired, onConfirm, onOpenChange]);

  const handleCancel = useCallback(() => {
    setMotivo('');
    setTypedConfirmation('');
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const isConfirmDisabled =
    isLoading ||
    (motivoRequired && !motivo.trim()) ||
    typedConfirmation !== confirmationText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl text-red-900">{title}</DialogTitle>
          <DialogDescription className="text-slate-700">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Campo de motivo */}
          <div className="space-y-2">
            <Label htmlFor="motivo" className="text-slate-900 font-medium">
              {motivoLabel}
              {motivoRequired && <span className="text-red-600 ml-1">*</span>}
            </Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={motivoPlaceholder}
              className="min-h-[100px] resize-none"
              disabled={isLoading}
            />
          </div>

          {/* Aviso de ação perigosa */}
          <InfoCallout variant="warning" size="sm" showIcon={false}>
            <InfoCalloutItem label="Atenção" labelTone="danger">
              Esta é uma ação irreversível e permanente. O cadastro será removido; registros
              obrigatórios de auditoria poderão ser preservados.
            </InfoCalloutItem>
          </InfoCallout>

          {/* Campo de confirmação por digitação */}
          <div className="space-y-2">
            <Label htmlFor="confirmation" className="text-slate-900 font-medium">
              {confirmationLabel}
              <span className="text-red-600 ml-1">*</span>
            </Label>
            <Input
              id="confirmation"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder={confirmationText}
              className={`font-mono ${
                typedConfirmation && typedConfirmation !== confirmationText
                  ? 'border-red-300 focus:border-red-400'
                  : typedConfirmation === confirmationText
                    ? 'border-green-300 focus:border-green-400'
                    : ''
              }`}
              disabled={isLoading}
              autoComplete="off"
            />
            {typedConfirmation && typedConfirmation !== confirmationText && (
              <p className="text-xs text-red-600">
                Texto não corresponde. Digite exatamente: <strong>{confirmationText}</strong>
              </p>
            )}
            {typedConfirmation === confirmationText && (
              <p className="text-xs text-green-600">Confirmação aceita</p>
            )}
          </div>

          {/* Mensagem de erro */}
          {error && (
            <InfoCallout variant="warning" size="sm" showIcon={false}>
              <InfoCalloutItem label="Não foi possível concluir" labelTone="danger">
                {error}
              </InfoCalloutItem>
            </InfoCallout>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
            className="border-slate-300"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isLoading ? loadingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

