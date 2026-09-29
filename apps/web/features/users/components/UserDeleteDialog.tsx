'use client';

import * as React from 'react';
import ActionConfirmationDialog from '@/components/dialogs/ActionConfirmationDialog';
import ReasonField from '@/components/shared/ReasonField';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  usuarioId: string | null;
  usuarioNome?: string;
  onDeleted?: () => void;
};

export default function UserDeleteDialog({
  open,
  onOpenChange,
  usuarioId,
  usuarioNome,
  onDeleted,
}: Props) {
  const [motivo, setMotivo] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setMotivo('');
  }, [open]);

  async function handleConfirm() {
    if (!usuarioId) return;
    try {
      setSubmitting(true);
      const params = new URLSearchParams();
      params.set('hard', '1');
      if (motivo.trim()) params.set('motivo', motivo.trim());
      const res = await fetch(`/api/users/${encodeURIComponent(usuarioId)}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data?.error?.message || data?.error || 'Erro ao excluir') as string);
        return;
      }
      toast.success('Usuário excluído');
      try {
        window.dispatchEvent(new CustomEvent('usuarios:changed'));
      } catch {
        /* noop */
      }
      onDeleted?.();
      onOpenChange(false);
    } catch {
      toast.error('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }

  const description = usuarioNome
    ? `Tem certeza que deseja excluir ${usuarioNome}? Esta ação é permanente.`
    : 'Tem certeza que deseja excluir este usuário? Esta ação é permanente.';

  return (
    <ActionConfirmationDialog
      open={open}
      title="Excluir usuário"
      description={description}
      confirmLabel={submitting ? 'Excluindo...' : 'Excluir'}
      cancelLabel="Cancelar"
      loadingLabel="Excluindo..."
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
    >
      <ReasonField
        id="motivo-usuario"
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        placeholder="Ex.: duplicado, teste, solicitação do responsável..."
      />
    </ActionConfirmationDialog>
  );
}
