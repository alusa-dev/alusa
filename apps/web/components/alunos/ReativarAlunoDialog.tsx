'use client';

import * as React from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  alunoId: string | null;
  alunoNome?: string;
  onReativado?: () => void;
};

export function ReativarAlunoDialog({
  open,
  onOpenChange,
  alunoId,
  alunoNome,
  onReativado,
}: Props) {
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    if (!alunoId) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/alunos/${alunoId}/reativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A reativação nesta tela altera somente o aluno. Matrículas,
        // cobranças e assinaturas pertencem aos seus próprios fluxos.
        body: JSON.stringify({ reativarMatriculas: false }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao reativar' }));
        toast.error(data.error || 'Erro ao reativar aluno');
        return;
      }

      const result = await res.json();

      toast.success(result.message || 'Aluno reativado com sucesso');

      try {
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch {
        /* noop */
      }

      onReativado?.();
      onOpenChange(false);
    } catch (error) {
      console.error('[ReativarAlunoDialog]', error);
      toast.error('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reativar aluno?"
      description={`Confirme a reativação de ${alunoNome || 'aluno selecionado'}. Somente o status do aluno será alterado para ativo. Matrículas, cobranças e assinaturas não serão modificadas.`}
      confirmText="Reativar aluno"
      cancelText="Cancelar"
      onConfirm={() => void handleConfirm()}
      loading={submitting}
    />
  );
}
