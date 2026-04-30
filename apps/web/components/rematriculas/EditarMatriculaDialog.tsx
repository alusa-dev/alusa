"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { pushToast } from '@/components/ui/toast';

interface EditarMatriculaDialogProps {
  matriculaId: string;
  defaultTurmaId?: string | null;
  defaultComboId?: string | null;
  defaultPlanoId?: string | null;
  onSaved: () => void;
}

type EditMode = 'turma' | 'combo';

export function EditarMatriculaDialog({
  matriculaId,
  defaultTurmaId,
  defaultComboId,
  defaultPlanoId,
  onSaved,
}: EditarMatriculaDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EditMode>(defaultComboId ? 'combo' : 'turma');
  const [turmaId, setTurmaId] = useState(defaultTurmaId ?? '');
  const [comboId, setComboId] = useState(defaultComboId ?? '');
  const [planoId, setPlanoId] = useState(defaultPlanoId ?? '');
  const [loading, setLoading] = useState(false);

  const resetState = () => {
    setMode(defaultComboId ? 'combo' : 'turma');
    setTurmaId(defaultTurmaId ?? '');
    setComboId(defaultComboId ?? '');
    setPlanoId(defaultPlanoId ?? '');
  };

  const handleSave = async () => {
    if (mode === 'turma' && !turmaId.trim()) {
      pushToast({
        title: 'Informe a turma',
        description: 'Selecione a turma de destino para continuar.',
        variant: 'warning',
      });
      return;
    }
    if (mode === 'turma' && !planoId.trim()) {
      pushToast({
        title: 'Informe o plano',
        description: 'Para turma avulsa, é necessário informar o plano.',
        variant: 'warning',
      });
      return;
    }
    if (mode === 'combo' && !comboId.trim()) {
      pushToast({
        title: 'Informe o combo',
        description: 'Selecione o combo de destino para continuar.',
        variant: 'warning',
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/matriculas/${matriculaId}/editar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turmaId: mode === 'turma' ? turmaId.trim() : null,
          comboId: mode === 'combo' ? comboId.trim() : null,
          planoId: mode === 'turma' ? planoId.trim() : null,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error?.message || 'Erro ao salvar edição');
      }

      pushToast({
        title: 'Matrícula atualizada',
        description: 'Turma/Plano atualizados com sucesso.',
        variant: 'success',
      });
      setOpen(false);
      onSaved();
    } catch (error) {
      pushToast({
        title: 'Erro ao editar matrícula',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) resetState();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-slate-300 text-slate-700">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar matrícula</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-3">
            <Button
              type="button"
              variant={mode === 'turma' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('turma')}
            >
              Turma
            </Button>
            <Button
              type="button"
              variant={mode === 'combo' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('combo')}
            >
              Combo
            </Button>
          </div>

          {mode === 'turma' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="turmaId">Turma destino (ID)</Label>
                <Input
                  id="turmaId"
                  placeholder="turma_..."
                  value={turmaId}
                  onChange={(e) => setTurmaId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planoId">Plano (ID)</Label>
                <Input
                  id="planoId"
                  placeholder="plano_..."
                  value={planoId}
                  onChange={(e) => setPlanoId(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="comboId">Combo (ID)</Label>
              <Input
                id="comboId"
                placeholder="combo_..."
                value={comboId}
                onChange={(e) => setComboId(e.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
