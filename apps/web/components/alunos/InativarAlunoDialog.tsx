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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  alunoId: string | null;
  alunoNome?: string;
  onInativado?: () => void;
};

export function InativarAlunoDialog({
  open,
  onOpenChange,
  alunoId,
  alunoNome,
  onInativado,
}: Props) {
  const [motivo, setMotivo] = React.useState('');
  const [acao, setAcao] = React.useState<'PAUSAR' | 'CANCELAR'>('PAUSAR');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMotivo('');
      setAcao('PAUSAR');
    }
  }, [open]);

  async function handleConfirm() {
    if (!alunoId) return;

    if (motivo.trim().length < 10) {
      toast.error('Motivo deve ter no mínimo 10 caracteres');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`/api/alunos/${alunoId}/inativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim(), acao }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao inativar' }));
        toast.error(data.error || 'Erro ao inativar aluno');
        return;
      }

      const result = await res.json();

      toast.success(
        result.message ||
          `Aluno inativado com sucesso (${result.data?.matriculasProcessadas?.length || 0} matrículas processadas)`,
      );

      try {
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch {
        /* noop */
      }

      onInativado?.();
      onOpenChange(false);
    } catch (error) {
      console.error('[InativarAlunoDialog]', error);
      toast.error('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Inativar Aluno</DialogTitle>
          <DialogDescription>
            Você está prestes a inativar o aluno{' '}
            <strong className="text-foreground">{alunoNome || 'selecionado'}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Motivo */}
          <div className="space-y-2">
            <Label htmlFor="motivo">
              Motivo da inativação <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: Mudança de cidade, desistência, inadimplência..."
              rows={3}
              required
              minLength={10}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Mínimo de 10 caracteres ({motivo.length}/10)
            </p>
          </div>

          {/* Ação */}
          <div className="space-y-2">
            <Label htmlFor="acao">O que fazer com as matrículas ativas?</Label>
            <select
              id="acao"
              value={acao}
              onChange={(e) => setAcao(e.target.value as 'PAUSAR' | 'CANCELAR')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="PAUSAR">Pausar (pode reativar depois)</option>
              <option value="CANCELAR">Cancelar definitivamente</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {acao === 'PAUSAR'
                ? '✅ As assinaturas serão pausadas. Pode reativar no futuro.'
                : '⚠️ As assinaturas serão canceladas permanentemente. Ação irreversível.'}
            </p>
          </div>
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
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || motivo.trim().length < 10}
            variant={acao === 'CANCELAR' ? 'destructive' : 'default'}
          >
            {submitting ? 'Inativando...' : 'Inativar Aluno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
