'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { MatriculaCreatedPayload } from '@/features/cadastro/matriculas/services/matriculas-service';
import { MatriculaWizardFlow } from './MatriculaWizardFlow';

interface MatriculaWizardDialogProps {
  open: boolean;
  contaId?: string;
  onOpenChange: (_open: boolean) => void;
  onCreated?: (_payload: MatriculaCreatedPayload) => void;
}

export default function MatriculaWizardDialog({
  open,
  contaId,
  onOpenChange,
  onCreated,
}: MatriculaWizardDialogProps) {
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setLeaveConfirmOpen(false);
    }
  }, [open]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      setLeaveConfirmOpen(true);
    },
    [onOpenChange],
  );

  const handleConfirmLeave = useCallback(() => {
    setLeaveConfirmOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          fullScreenMobile
          className="max-w-5xl w-full gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl md:transition-all md:duration-300"
          data-testid="matricula-wizard"
        >
          <DialogTitle className="sr-only">Cadastrar matrícula</DialogTitle>
          <DialogDescription className="sr-only">
            Preencha os dados da matrícula em etapas.
          </DialogDescription>
          <MatriculaWizardFlow
            contaId={contaId}
            open={open}
            variant="dialog"
            onClose={() => onOpenChange(false)}
            onCompleted={onCreated}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title="Sair do cadastro de matrícula?"
        description="Os dados preenchidos até agora serão descartados. Confirme apenas se quiser interromper este cadastro."
        confirmText="Sair do cadastro"
        cancelText="Continuar preenchendo"
        variant="destructive"
        onConfirm={handleConfirmLeave}
      />
    </>
  );
}
