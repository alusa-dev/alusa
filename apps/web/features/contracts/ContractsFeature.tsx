
'use client';

import { useRouter } from 'next/navigation';
import { TableLayout } from '@/components/layout/TableLayout';
import { useStudentContracts, type StudentContractsStatusFilter } from './hooks/use-student-contracts';
import { StudentContractCard } from './components/StudentContractCard';
import useCurrentUser from '@/hooks/use-current-user';
import { useClasses } from '@/features/classes/hooks/use-classes';
import { useState } from 'react';
import { StudentContractsFiltersBar } from './components/StudentContractsFiltersBar';
import { StudentContractCardSkeleton } from './components/StudentContractCardSkeleton';

export function ContratosFeature() {
  const router = useRouter();

  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;
  const { items: turmas, loading: turmasLoading } = useClasses({ contaId });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StudentContractsStatusFilter>('TODOS');
  const [turmaId, setTurmaId] = useState<string>('');
  const [page, setPage] = useState(1);

  const { alunos, loading, pagination } = useStudentContracts({ search, status, turmaId, page });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value: StudentContractsStatusFilter) => {
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
        <StudentContractsFiltersBar
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
        <StudentContractsFiltersBar
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
              <StudentContractCardSkeleton key={idx} />
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
                <StudentContractCard
                  key={aluno.id}
                  aluno={aluno}
                  onClick={(id) => router.push(`/contracts/student/${id}`)}
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
