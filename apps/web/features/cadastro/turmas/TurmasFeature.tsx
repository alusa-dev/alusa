'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
// Skeleton manual será substituído pelos skeletons do DataTable
import { Plus, Edit3, Trash2, CalendarDaysIcon } from '@/components/icons/icons';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import useCurrentUser from '@/hooks/use-current-user';
import { formatFirstLast } from '@alusa/lib/client';
import TurmaDialog, { type TurmaDialogMode } from '@/components/turmas/TurmaDialog';
import { type TurmaListItem } from './services/turmas-service';
import { useTurmas, type UseTurmasFilters } from './hooks/use-turmas';

const PAGE_SIZE = 10;

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';

interface TurmasTableProps {
  turmas: TurmaListItem[];
  accountMissing: boolean;
  onEdit: (_turma: TurmaListItem) => void;
  onDelete: (_turma: TurmaListItem) => void;
  onViewAgenda: (_turma: TurmaListItem) => void;
  loading: boolean;
}

export function TurmasFeature() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, reload, remove, setItems } = useTurmas({ contaId });
  const deleteDialog = useDeleteDialog<TurmaListItem>({
    onDelete: async (turma) => {
      if (!contaId) throw new Error('Conta não informada para exclusão.');
      await remove({ id: turma.id, contaId });
    },
  });

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: TurmaDialogMode;
    turma: TurmaListItem | null;
  }>({ open: false, mode: 'create', turma: null });
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const {
    search: searchTerm,
    setSearch: setSearchTerm,
    status: statusFilter,
    setStatus: setStatusFilter,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    paginated,
    total,
  } = useEntityListFiltering<TurmaListItem>({
    items,
    nameAccessor: (turma) => turma.nome || '',
    statusAccessor: (turma) => (turma.status === 'INATIVO' ? 'INATIVO' : 'ATIVO'),
    searchPredicate: (turma, term, digits) => {
      if (!term && !digits) return true;
      const nome = (turma.nome || '').toLowerCase();
      const descricao = (turma.descricao || '').toLowerCase();
      const professoresNomes = turma.professores.map((prof) => prof.nome.toLowerCase()).join(' ');
      const capacidadeValue = String(turma.capacidade ?? '');
      return (
        (!!term &&
          (nome.includes(term) || descricao.includes(term) || professoresNomes.includes(term))) ||
        (!!digits && capacidadeValue.includes(digits))
      );
    },
  });

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [setPageSize]);

  useEffect(() => {
    const handler = () => {
      void reload({ search: searchTerm, status: statusFilter });
    };
    window.addEventListener('turmas:changed', handler);
    return () => window.removeEventListener('turmas:changed', handler);
  }, [reload, searchTerm, statusFilter]);

  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);

  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  const handleSearch = () => {
    const filters: UseTurmasFilters = {
      search: searchTerm,
      status: statusFilter,
    };
    void reload(filters);
  };

  const accountMissing = !contaId && !userLoading;

  return (
    <>
      <TableLayout
        title="Turmas"
        subtitle="Gerencie turmas, horários e capacidades."
        actions={
          <Button
            disabled={!contaId}
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
            onClick={() => setDialogState({ open: true, mode: 'create', turma: null })}
          >
            <Plus className="h-4 w-4 mr-2" /> Nova turma
          </Button>
        }
        filtersBar={
          <EntityFiltersBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            onSearchEnter={handleSearch}
            statusValue={statusFilter}
            onStatusChange={(value) => {
              setStatusFilter(value);
              void reload({ search: searchTerm, status: value });
            }}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            searchPlaceholder="Buscar por nome..."
          />
        }
        footer={<Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />}
      >
        <div className="bg-white rounded-xl border overflow-hidden">
          <TurmasTable
            turmas={paginated}
            accountMissing={accountMissing}
            onEdit={(turma) => {
              setDialogState({ open: true, mode: 'edit', turma });
            }}
            onDelete={(turma) => {
              deleteDialog.openDialog(turma);
            }}
            onViewAgenda={(turma) => {
              router.push(`/aulas/agenda?turmaId=${encodeURIComponent(turma.id)}`);
            }}
            loading={loading || userLoading}
          />
        </div>
      </TableLayout>

      {contaId ? (
        <TurmaDialog
          open={dialogState.open}
          mode={dialogState.mode}
          turma={dialogState.turma}
          contaId={contaId}
          onOpenChange={(open) => {
            if (!open) setDialogState({ open: false, mode: 'create', turma: null });
          }}
          onSaved={(saved) => {
            setItems((prev) => {
              const exists = prev.some((t) => t.id === saved.id);
              if (exists) {
                return prev.map((t) => (t.id === saved.id ? { ...t, ...saved } : t));
              }
              return [saved, ...prev];
            });
            setDialogState({ open: false, mode: 'create', turma: null });
            window.dispatchEvent(new CustomEvent('turmas:changed'));
            toast.custom((t) => (
              <CustomToast
                variant="success"
                title={dialogState.mode === 'edit' ? 'Turma atualizada' : 'Turma criada'}
                description={
                  dialogState.mode === 'edit' ? 'Alterações salvas.' : 'Turma registrada.'
                }
                onClose={() => toast.dismiss(t)}
              />
            ));
          }}
          onError={(message) => {
            toast.custom((t) => (
              <CustomToast
                variant="error"
                title="Erro ao salvar"
                description={message}
                onClose={() => toast.dismiss(t)}
              />
            ));
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir turma"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Tem certeza que deseja excluir esta turma? Esta ação não pode ser desfeita.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'esta turma';
          return (
            <span>
              Tem certeza que deseja excluir a turma <strong>{shortName}</strong>? Esta ação não
              pode ser desfeita.
            </span>
          );
        })()}
        confirmLabel={deleteDialog.loading ? 'Excluindo...' : 'Excluir'}
        loadingLabel="Excluindo..."
        cancelLabel="Cancelar"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={async () => {
          try {
            await deleteDialog.confirm();
            toast.custom((t) => (
              <CustomToast
                variant="success"
                title="Turma excluída"
                description="A turma foi removida."
                onClose={() => toast.dismiss(t)}
              />
            ));
            window.dispatchEvent(new CustomEvent('turmas:changed'));
            void reload({ search: searchTerm, status: statusFilter });
          } catch (error) {
            toast.custom((t) => (
              <CustomToast
                variant="error"
                title="Erro ao excluir"
                description={(error as Error).message}
                onClose={() => toast.dismiss(t)}
              />
            ));
          }
        }}
      />
    </>
  );
}

function TurmasTable({
  turmas,
  accountMissing,
  onEdit,
  onDelete,
  onViewAgenda,
  loading,
}: TurmasTableProps) {
  if (accountMissing) {
    return (
      <div className="px-6 py-12 text-center text-gray-500">
        Conecte-se a uma conta para visualizar as turmas cadastradas.
      </div>
    );
  }

  const formatDiasSemana = (dias: TurmaListItem['diasSemana']) => {
    if (!dias || dias.length === 0) return '—';
    const labels: Record<string, string> = {
      SEGUNDA: 'Seg',
      TERCA: 'Ter',
      QUARTA: 'Qua',
      QUINTA: 'Qui',
      SEXTA: 'Sex',
      SABADO: 'Sáb',
      DOMINGO: 'Dom',
    };
    return dias
      .map((dia) => labels[dia.toUpperCase()] ?? dia)
      .join(', ');
  };

  const columns: DataTableColumn<TurmaListItem>[] = [
    {
      id: 'nome',
      header: 'Turma',
      width: 'w-1/5',
      align: 'left',
      render: (t) => (
        <div className="text-[13px] text-gray-900 font-medium truncate" title={t.nome}>
          {t.nome}
        </div>
      ),
      skeleton: <div className="h-4 w-40 bg-gray-200 rounded" />,
    },
    {
      id: 'dias',
      header: 'Dias',
      width: 'w-1/5',
      align: 'center',
      render: (t) => (
        <span className="text-[13px] text-gray-600 whitespace-nowrap">
          {formatDiasSemana(t.diasSemana)}
        </span>
      ),
      skeleton: <div className="h-4 w-28 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'horario',
      header: 'Horário',
      width: 'w-1/6',
      align: 'center',
      render: (t) => (
        <span className="text-[13px] text-gray-600 whitespace-nowrap">
          {t.horaInicio} - {t.horaFim}
        </span>
      ),
      skeleton: <div className="h-4 w-24 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'professores',
      header: 'Professores',
      width: 'w-1/4',
      align: 'center',
      noWrap: false,
      render: (t) => (
        <div className="flex flex-wrap gap-1 justify-center">
          {t.professores.length > 0 ? (
            <>
              {t.professores.slice(0, 3).map((professor) => (
                <Badge
                  key={professor.id}
                  variant="default"
                  size="sm"
                  title={professor.nome}
                >
                  {professor.nome.split(' ').slice(0, 2).join(' ')}
                </Badge>
              ))}
              {t.professores.length > 3 && (
                <Badge variant="default" size="sm">
                  +{t.professores.length - 3}
                </Badge>
              )}
            </>
          ) : (
            <Badge variant={t.professoresCount > 0 ? 'default' : 'neutral'} size="sm">
              {t.professoresCount > 0 ? `${t.professoresCount} prof.` : 'Sem professor'}
            </Badge>
          )}
        </div>
      ),
      skeleton: <div className="h-4 w-40 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'capacidade',
      header: 'Capacidade',
      width: 'w-1/6',
      align: 'center',
      render: (t) => (
        <span className="text-[13px] text-gray-700 whitespace-nowrap">
          {t.capacidade ?? '—'}
        </span>
      ),
      skeleton: <div className="h-4 w-10 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-24',
      align: 'right',
      headerClassName: 'px-6',
      cellClassName: 'px-6',
      render: (t) => (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            aria-label="Ver agenda da turma"
            onClick={() => onViewAgenda(t)}
          >
            <CalendarDaysIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            aria-label="Editar turma"
            onClick={() => onEdit(t)}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            aria-label="Excluir turma"
            onClick={() => onDelete(t)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      ),
      skeleton: (
        <div className="flex justify-center gap-2">
          <div className="h-8 w-8 bg-gray-200 rounded" />
          <div className="h-8 w-8 bg-gray-200 rounded" />
          <div className="h-8 w-8 bg-gray-200 rounded" />
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={turmas}
      rowKey={(t) => t.id}
      loading={loading}
      skeletonRows={5}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500">Nenhuma turma encontrada</div>
      }
      ariaLabel="Tabela de turmas"
    />
  );
}

export default TurmasFeature;
