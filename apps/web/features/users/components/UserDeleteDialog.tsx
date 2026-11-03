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
      const res = await fetch(`/api/users/${encodeURIComponent(usuarioId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(motivo.trim() ? { reason: motivo.trim() } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data?.error?.message || data?.error || 'Erro ao remover acesso') as string);
        return;
      }
      toast.success('Acesso suspenso nesta escola');
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
    ? `Tem certeza que deseja suspender o acesso de ${usuarioNome} a esta escola? O cadastro e os vínculos serão preservados, e o acesso poderá ser reativado depois.`
    : 'Tem certeza que deseja suspender o acesso deste usuário a esta escola? O cadastro e os vínculos serão preservados.';

  return (
    <ActionConfirmationDialog
      open={open}
      title="Suspender acesso"
      description={description}
      confirmLabel={submitting ? 'Suspendendo...' : 'Suspender acesso'}
      cancelLabel="Cancelar"
      loadingLabel="Suspendendo..."
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
