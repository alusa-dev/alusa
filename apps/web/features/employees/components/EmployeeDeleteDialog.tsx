'use client';

import * as React from 'react';
import ActionConfirmationDialog from '@/components/dialogs/ActionConfirmationDialog';
import ReasonField from '@/components/shared/ReasonField';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  colaboradorId: string | null;
  colaboradorNome?: string;
  onDeleted?: () => void;
};

export default function EmployeeDeleteDialog({
  open,
  onOpenChange,
  colaboradorId,
  colaboradorNome,
  onDeleted,
}: Props) {
  const [motivo, setMotivo] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setMotivo('');
  }, [open]);

  async function handleConfirm() {
    if (!colaboradorId) return;
    try {
      setSubmitting(true);
      const res = await fetch(`/api/colaboradores/${colaboradorId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data?.error?.message || data?.error || 'Erro ao excluir') as string);
        return;
      }
      toast.success('Colaborador excluído');
      try {
        window.dispatchEvent(new CustomEvent('colaboradores:changed'));
      } catch {
        void 0;
      }
      onDeleted?.();
      onOpenChange(false);
    } catch {
      toast.error('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }

  const description = colaboradorNome
    ? `Tem certeza que deseja excluir o colaborador ${colaboradorNome}? Esta ação não pode ser desfeita.`
    : 'Tem certeza que deseja excluir este colaborador? Esta ação não pode ser desfeita.';

  return (
    <ActionConfirmationDialog
      open={open}
      title="Excluir colaborador"
      description={description}
      confirmLabel={submitting ? 'Excluindo...' : 'Excluir'}
      cancelLabel="Cancelar"
      loadingLabel="Excluindo..."
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
    >
      <ReasonField
        id="motivo-colaborador"
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Ex.: duplicado, teste..."
      />
    </ActionConfirmationDialog>
  );
}
