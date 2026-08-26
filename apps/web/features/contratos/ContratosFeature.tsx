
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
  const [page, setPage] = useState(1);

  const { alunos, loading, pagination } = useContratosAlunos({ search, status, turmaId, page });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value: ContratosAlunoStatusFilter) => {
    setStatus(value);
    setPage(1);
  };

  const handleTurmaChange = (value: string) => {
    setTurmaId(value);
    setPage(1);
  };

  return (
    <TableLayout
      title="Gestão de Contratos"
      subtitle="Acompanhe os status das assinaturas e gerencie contratos gerados."
      actions={
        <ContratosAlunosFiltersBar
          mode="search"
          searchValue={search}
          onSearchChange={handleSearchChange}
          statusValue={status}
          onStatusChange={handleStatusChange}
          turmaId={turmaId}
          onTurmaChange={handleTurmaChange}
          turmas={turmas}
          turmasLoading={turmasLoading}
          disabled={!contaId}
        />
      }
      filtersBar={
        <ContratosAlunosFiltersBar
          mode="filters"
          searchValue={search}
          onSearchChange={handleSearchChange}
          statusValue={status}
          onStatusChange={handleStatusChange}
          turmaId={turmaId}
          onTurmaChange={handleTurmaChange}
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
          <div className="space-y-4">
            <div className="space-y-3">
              {alunos.map((aluno) => (
                <AlunoContratoCard
                  key={aluno.id}
                  aluno={aluno}
                  onClick={(id) => router.push(`/contratos/aluno/${id}`)}
                />
              ))}
            </div>
            {pagination.totalPages > 1 && (
              <nav
                aria-label="Paginação de alunos com contratos"
                className="flex flex-col gap-3 border-t border-gray-100 pt-4 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  Página {pagination.page} de {pagination.totalPages} · {pagination.total}{' '}
                  {pagination.total === 1 ? 'aluno' : 'alunos'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={!pagination.hasPreviousPage || loading}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!pagination.hasNextPage || loading}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </nav>
            )}
          </div>
        )}
      </div>
    </TableLayout>
  );
}
