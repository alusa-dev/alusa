'use client';

import * as React from 'react';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  usuarioId: string | null;
  usuarioNome?: string;
  onDeleted?: () => void;
};

export default function UsuarioDeleteDialog({
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
    <ConfirmDeleteDialog
      open={open}
      title="Excluir usuário"
      description={description}
      confirmLabel={submitting ? 'Excluindo...' : 'Excluir'}
      cancelLabel="Cancelar"
      loadingLabel="Excluindo..."
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
    >
      <div className="space-y-3 text-left">
        <label
          htmlFor="motivo-usuario"
          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Motivo (opcional)
        </label>
        <textarea
          id="motivo-usuario"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-[#7A1BFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40"
          placeholder="Ex.: duplicado, teste, solicitação do responsável..."
        />
        <p className="text-xs leading-4 text-slate-500">
          Esse registro não é obrigatório, mas ajuda a manter o histórico da equipe.
        </p>
      </div>
    </ConfirmDeleteDialog>
  );
}
