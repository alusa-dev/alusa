'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTurmas } from '../hooks/use-turmas';
import { TurmaCard } from './TurmaCard';
import { TurmaCardSkeleton } from './TurmaCardSkeleton';
import { Button } from '@/components/ui/button';
import useCurrentUser from '@/hooks/use-current-user';
import MatriculaWizardDialog from '@/components/matriculas/MatriculaWizardDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, { type StatusValue, type SortOrder } from '@/components/layout/EntityFiltersBar';

export default function TurmasGridFeature() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useCurrentUser();
  const contaId = user?.contaId;
  const [search, setSearch] = useState('');
  const [statusValue, setStatusValue] = useState<StatusValue>('TODOS');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [wizardOpen, setWizardOpen] = useState(false);
  const shouldOpenWizard = searchParams.get('new') === '1';

  const handleOpenWizard = async () => {
    setWizardOpen(true);
  };

  useEffect(() => {
    if (shouldOpenWizard && contaId) {
      setWizardOpen(true);
    }
  }, [shouldOpenWizard, contaId]);

  const { items, loading } = useTurmas({ contaId });

  const filteredItems = items.filter(t => {
    const matchesSearch = t.nome.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusValue === 'TODOS' || t.status === statusValue;
    return matchesSearch && matchesStatus;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortOrder === 'ASC') {
      return a.nome.localeCompare(b.nome);
    }
    return b.nome.localeCompare(a.nome);
  });

  if (!contaId) {
    return (
      <TableLayout
        title="Gestão de Matrículas"
        subtitle="Acompanhe matrículas, cobranças e vínculos de turmas em tempo real."
      >
        <div className="flex items-center justify-center p-12">
          <p className="text-gray-500">Carregando informações do usuário...</p>
        </div>
      </TableLayout>
    );
  }

  return (
    <TableLayout
      title="Gestão de Matrículas"
      subtitle="Acompanhe matrículas, cobranças e vínculos de turmas em tempo real."
      actions={
        <Button
          onClick={handleOpenWizard}
          className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
          aria-label="Cadastrar matrícula"
          disabled={!contaId}
        >
          Nova matrícula
        </Button>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={search}
          onSearchChange={setSearch}
          statusValue={statusValue}
          onStatusChange={setStatusValue}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          searchPlaceholder="Buscar por turma..."
        />
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <TurmaCardSkeleton key={i} />
          ))}
        </div>
      ) : sortedItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedItems.map((turma) => (
            <TurmaCard 
              key={turma.id} 
              turma={turma} 
              onClick={() => router.push(`/matriculas/turma/${turma.id}`)} 
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed">
          <p className="text-gray-500">Nenhuma turma encontrada.</p>
        </div>
      )}

      <MatriculaWizardDialog
        open={wizardOpen}
        contaId={contaId ?? undefined}
        onOpenChange={setWizardOpen}
        onCreated={() => {
          toast.custom((t) => (
            <CustomToast
              variant="success"
              title="Matrícula criada"
              description="A matrícula foi criada com sucesso."
              onClose={() => toast.dismiss(t)}
            />
          ));
        }}
      />
    </TableLayout>
  );
}
