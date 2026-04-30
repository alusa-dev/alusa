'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
          className="w-full max-w-5xl overflow-visible rounded-2xl bg-slate-50 p-0 transition-all duration-300"
          data-testid="matricula-wizard"
        >
          <DialogTitle className="sr-only">Cadastrar matrícula</DialogTitle>
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
