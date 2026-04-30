
'use client';

import { useRouter } from 'next/navigation';
import { TableLayout } from '@/components/layout/TableLayout';
import { useContratosAlunos, type ContratosAlunoStatusFilter } from './hooks/use-contratos-alunos';
import { AlunoContratoCard } from './components/AlunoContratoCard';
import useCurrentUser from '@/hooks/use-current-user';
import { useTurmas } from '@/features/cadastro/turmas/hooks/use-turmas';
import { useState } from 'react';
import { ContratosAlunosFiltersBar } from './components/ContratosAlunosFiltersBar';
import { AlunoContratoCardSkeleton } from './components/AlunoContratoCardSkeleton';

export function ContratosFeature() {
  const router = useRouter();

  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;
  const { items: turmas, loading: turmasLoading } = useTurmas({ contaId });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContratosAlunoStatusFilter>('TODOS');
  const [turmaId, setTurmaId] = useState<string>('');

  const { alunos, loading } = useContratosAlunos({ search, status, turmaId });

  return (
    <TableLayout
      title="Gestão de Contratos"
      subtitle="Acompanhe os status das assinaturas e gerencie contratos gerados."
      actions={
        <ContratosAlunosFiltersBar
          mode="search"
          searchValue={search}
          onSearchChange={setSearch}
          statusValue={status}
          onStatusChange={(v) => setStatus(v as ContratosAlunoStatusFilter)}
          turmaId={turmaId}
          onTurmaChange={setTurmaId}
          turmas={turmas}
          turmasLoading={turmasLoading}
          disabled={!contaId}
        />
      }
      filtersBar={
        <ContratosAlunosFiltersBar
          mode="filters"
          searchValue={search}
          onSearchChange={setSearch}
          statusValue={status}
          onStatusChange={(v) => setStatus(v as ContratosAlunoStatusFilter)}
          turmaId={turmaId}
          onTurmaChange={setTurmaId}
          turmas={turmas}
          turmasLoading={turmasLoading}
          disabled={!contaId}
        />
      }
    >
      <div className="space-y-3">
        {(loading || userLoading) && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <AlunoContratoCardSkeleton key={idx} />
            ))}
          </div>
        )}

        {!loading && !userLoading && alunos.length === 0 && (
          <div className="rounded-xl border bg-white px-6 py-12 text-center text-gray-500 text-sm">
            Nenhum aluno com contratos encontrado.
          </div>
        )}

        {!loading && !userLoading && alunos.length > 0 && (
          <div className="space-y-3">
            {alunos.map((aluno) => (
              <AlunoContratoCard
                key={aluno.id}
                aluno={aluno}
                onClick={(id) => router.push(`/contratos/aluno/${id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </TableLayout>
  );
}
