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
import { table } from '@/components/layout/TableStyles';
import { type TurmaListItem } from './services/turmas-service';
import { useTurmas, type UseTurmasFilters } from './hooks/use-turmas';
import { cn } from '@/lib/utils';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';

const PAGE_SIZE = 6;

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
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
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
      >
        <div className={table.container}>
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
          {total > pageSize ? (
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
              <Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />
            </div>
          ) : null}
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
      width: 'min-w-0 lg:w-[22%]',
      align: 'left',
      render: (t) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-gray-900" title={t.nome}>
            {t.nome}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-gray-500 lg:hidden">
            {formatDiasSemana(t.diasSemana)} · {t.horaInicio}–{t.horaFim}
            {t.capacidade != null ? ` · Cap. ${t.capacidade}` : ''}
          </div>
        </div>
      ),
      skeleton: (
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-3 w-full max-w-[200px] rounded bg-gray-200 lg:hidden" />
        </div>
      ),
    },
    {
      id: 'dias',
      header: 'Dias',
      width: 'lg:w-[14%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (t) => (
        <span className="whitespace-nowrap text-[13px] text-gray-600">
          {formatDiasSemana(t.diasSemana)}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-28 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'horario',
      header: 'Horário',
      width: 'lg:w-[12%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (t) => (
        <span className="whitespace-nowrap text-[13px] text-gray-600">
          {t.horaInicio} - {t.horaFim}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'professores',
      header: 'Professores',
      width: 'lg:w-[24%]',
      align: 'center',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (t) => (
        <div className="flex flex-wrap justify-center gap-1">
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
      skeleton: <div className="mx-auto hidden h-4 w-40 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'capacidade',
      header: 'Capacidade',
      width: 'lg:w-[12%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (t) => (
        <span className="whitespace-nowrap text-[13px] text-gray-700">
          {t.capacidade ?? '—'}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-10 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[6.75rem] max-lg:shrink-0 lg:w-[16%]',
      align: 'right',
      headerClassName: 'px-3 lg:px-6',
      cellClassName: cn('px-2 lg:px-6', 'text-right'),
      render: (t) => (
        <div className="inline-flex justify-end gap-0 sm:gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            aria-label="Ver agenda da turma"
            onClick={() => onViewAgenda(t)}
          >
            <CalendarDaysIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-gray-600 hover:bg-gray-50 hover:text-gray-800"
            aria-label="Editar turma"
            onClick={() => onEdit(t)}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
            aria-label="Excluir turma"
            onClick={() => onDelete(t)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      skeleton: (
        <div className="flex justify-end gap-2">
          <div className="h-8 w-8 rounded bg-gray-200" />
          <div className="h-8 w-8 rounded bg-gray-200" />
          <div className="h-8 w-8 rounded bg-gray-200" />
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
