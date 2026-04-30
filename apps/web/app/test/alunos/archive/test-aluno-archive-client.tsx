'use client';

import { useState } from 'react';
import AlunoDeleteDialog from '@/components/alunos/AlunoDeleteDialog';
import { Button } from '@/components/ui/button';

type Props = {
  alunoId: string;
};

export default function TestAlunoArchiveClient({ alunoId }: Props) {
  const [open, setOpen] = useState(false);
  const [currentAlunoId, setCurrentAlunoId] = useState(alunoId);
  const [currentAlunoNome, setCurrentAlunoNome] = useState('Aluno Teste');

  return (
    <div className="p-6 space-y-4" data-testid="test-aluno-archive-page">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="test-aluno-id-input">
          Aluno ID
        </label>
        <input
          id="test-aluno-id-input"
          data-testid="test-aluno-id-input"
          className="w-full rounded border px-3 py-2 text-sm"
          value={currentAlunoId}
          onChange={(event) => setCurrentAlunoId(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="test-aluno-nome-input">
          Aluno Nome
        </label>
        <input
          id="test-aluno-nome-input"
          data-testid="test-aluno-nome-input"
          className="w-full rounded border px-3 py-2 text-sm"
          value={currentAlunoNome}
          onChange={(event) => setCurrentAlunoNome(event.target.value)}
        />
      </div>

      <Button
        data-testid="test-open-archive-dialog"
        onClick={() => setOpen(true)}
        disabled={!currentAlunoId}
      >
        Abrir Arquivamento
      </Button>

      <AlunoDeleteDialog
        open={open}
        onOpenChange={setOpen}
        alunoId={currentAlunoId || null}
        alunoNome={currentAlunoNome}
        onDeleted={() => setOpen(false)}
      />
    </div>
  );
}
