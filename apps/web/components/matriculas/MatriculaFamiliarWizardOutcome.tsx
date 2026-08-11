'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function MatriculaFamiliarWizardOutcome(props: { onClose: () => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialogContent className="z-[101] max-w-sm gap-5 p-6">
        <AlertDialogHeader>
          <AlertDialogTitle>Matrícula familiar criada com sucesso</AlertDialogTitle>
          <AlertDialogDescription>
            A matrícula familiar e o contrato foram registrados corretamente.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onClose}>Fechar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
