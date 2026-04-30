'use client';

import * as React from 'react';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  colaboradorId: string | null;
  colaboradorNome?: string;
  onDeleted?: () => void;
};

export default function ColaboradorDeleteDialog({
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
    <ConfirmDeleteDialog
      open={open}
      title="Excluir colaborador"
      description={description}
      confirmLabel={submitting ? 'Excluindo...' : 'Excluir'}
      cancelLabel="Cancelar"
      loadingLabel="Excluindo..."
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
    >
      <div className="space-y-3 text-left">
        <label
          htmlFor="motivo-colaborador"
          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Motivo (opcional)
        </label>
        <textarea
          id="motivo-colaborador"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-[#7A1BFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40"
          placeholder="Ex.: duplicado, teste..."
        />
        <p className="text-xs leading-4 text-slate-500">
          O motivo é opcional e ajuda o time a entender o contexto da exclusão.
        </p>
      </div>
    </ConfirmDeleteDialog>
  );
}
