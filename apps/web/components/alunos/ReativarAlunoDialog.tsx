'use client';

import * as React from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
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
  const [reativarMatriculas, setReativarMatriculas] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReativarMatriculas(false);
    }
  }, [open]);

  async function handleConfirm() {
    if (!alunoId) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/alunos/${alunoId}/reativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reativarMatriculas }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao reativar' }));
        toast.error(data.error || 'Erro ao reativar aluno');
        return;
      }

      const result = await res.json();

      toast.success(
        result.message ||
          `Aluno reativado com sucesso${reativarMatriculas ? ` (${result.data?.matriculasReativadas?.length || 0} matrículas reativadas)` : ''}`,
      );

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Reativar Aluno</DialogTitle>
          <DialogDescription>
            Você está prestes a reativar o aluno{' '}
            <strong className="text-foreground">{alunoNome || 'selecionado'}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Reativar Matrículas */}
          <div className="flex items-start space-x-3 rounded-lg border p-4">
            <Checkbox
              id="reativarMatriculas"
              checked={reativarMatriculas}
              onCheckedChange={(checked) => setReativarMatriculas(checked === true)}
            />
            <div className="space-y-1 leading-none">
              <Label
                htmlFor="reativarMatriculas"
                className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Reativar matrículas pausadas
              </Label>
              <p className="text-xs text-muted-foreground">
                Se marcado, todas as matrículas pausadas deste aluno serão reativadas
                automaticamente no Asaas.
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {reativarMatriculas
              ? '✅ As assinaturas financeiras serão reativadas automaticamente.'
              : 'ℹ️ As matrículas permanecerão pausadas. Você pode reativá-las manualmente depois.'}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Reativando...' : 'Reativar Aluno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
