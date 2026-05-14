"use client";
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import TableLayout from '@/components/layout/TableLayout';
import { table } from '@/components/layout/TableStyles';
import { Plus } from '@/components/icons/icons';
import Pagination from '@/components/layout/Pagination';
import EntityFiltersBar from '@/components/layout/EntityFiltersBar';
import { useCombos } from '../hooks/use-combos';
import {
  createComboRequest,
  updateComboRequest,
  deleteComboRequest,
  type ComboListItem,
  type CreateComboInput,
  type UpdateComboInput,
} from '../services/combos-service';
import ComboDialog from './ComboDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { cn } from '@/lib/utils';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import { formatPlanoValorBRL } from '@/features/cadastro/planos/services/planos-service';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import useCurrentUser from '@/hooks/use-current-user';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';

export function CombosFeature() {
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;
  const { items, loading, reload } = useCombos({ contaId, search: undefined });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<ComboListItem | null>(null);

  const pageSize = 10;

  const accountMissing = !contaId;
  const deleteDialog = useDeleteDialog<ComboListItem>({
    onDelete: async (combo) => {
      const targetContaId = contaId ?? combo.contaId;
      if (!targetContaId) throw new Error('Conta não informada para excluir combo.');
      await deleteComboRequest({ id: combo.id, contaId: targetContaId });
      await reload();
    },
  });

  const {
    search: searchTerm,
    setSearch: setSearchTerm,
    status: statusFilter,
    setStatus: setStatusFilter,
    sort,
    setSort,
    page,
    setPage,
    ordered,
    paginated,
    resetFilters,
  } = useEntityListFiltering<ComboListItem>({
    items,
    nameAccessor: (combo) => combo.nome ?? "",
    statusAccessor: (combo) => combo.status ?? "ATIVO",
    initialSort: "ASC",
  });

  const handleSearch = useCallback(() => {
    void reload({
      status: statusFilter === "TODOS" ? undefined : statusFilter,
      search: searchTerm,
    });
  }, [reload, statusFilter, searchTerm]);

  useEffect(() => {
    void reload({
      status: statusFilter === "TODOS" ? undefined : statusFilter,
      search: searchTerm,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDialogMode('create');
    setDialogOpen(true);
  };
  const openEdit = (combo: ComboListItem) => {
    setEditing(combo);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  async function handleSubmit(data: CreateComboInput | UpdateComboInput) {
    if (!contaId) return;
    try {
      if ('id' in data) await updateComboRequest(data);
      else await createComboRequest(data);
      await reload();
      setDialogOpen(false);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title={dialogMode === 'edit' ? 'Combo atualizado' : 'Combo criado'}
          description={dialogMode === 'edit' ? 'Alterações salvas.' : 'Registro criado.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro"
          description={(e as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  const periodicidadeLabel = (p: string) => {
    const labels: Record<string, string> = {
      SEMANAL: 'Semanal',
      QUINZENAL: 'Quinzenal',
      MENSAL: 'Mensal',
      TRIMESTRAL: 'Trimestral',
      ANUAL: 'Anual',
    };
    return labels[p] ?? p;
  };

  const columns: DataTableColumn<ComboListItem>[] = [
    {
      id: 'nome',
      header: 'Nome',
      width: 'min-w-0 lg:w-[28%]',
      align: 'left',
      render: (c) => (
        <div className="min-w-0">
          <div className={cn(table.primaryText, 'whitespace-normal break-words font-medium')} title={c.nome}>
            {c.nome}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-gray-500 lg:hidden">
            {formatPlanoValorBRL(c.valor)} · {periodicidadeLabel(c.periodicidade)} · {c.turmas.length}{' '}
            turma{c.turmas.length === 1 ? '' : 's'}
          </div>
        </div>
      ),
      skeleton: (
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-3 w-36 rounded bg-gray-200 lg:hidden" />
        </div>
      ),
    },
    {
      id: 'valor',
      header: 'Valor do Ciclo',
      width: 'lg:w-[15%]',
      align: 'right',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => (
        <span className="whitespace-nowrap font-medium text-gray-900">
          {formatPlanoValorBRL(c.valor)}
        </span>
      ),
      skeleton: <div className="ml-auto hidden h-4 w-16 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'periodicidade',
      header: 'Periodicidade',
      width: 'lg:w-[15%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => <span className="text-gray-700">{periodicidadeLabel(c.periodicidade)}</span>,
      skeleton: <div className="mx-auto hidden h-4 w-16 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'qtd',
      header: 'Qtd Turmas',
      width: 'lg:w-[12%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => c.turmas.length,
      skeleton: <div className="mx-auto hidden h-4 w-6 rounded bg-gray-200 lg:block" />,
    },
    (() => {
      const col = statusColumn<ComboListItem>({ activeLabel: 'Ativo', inactiveLabel: 'Inativo' });
      return {
        ...col,
        width: 'w-[4.5rem] max-lg:shrink-0 max-lg:whitespace-nowrap lg:w-[14%]',
        cellClassName: cn(col.cellClassName, 'align-middle'),
      };
    })(),
    (() => {
      const col = actionsColumn<ComboListItem>({
        onEdit: (c) => openEdit(c),
        onDelete: (c) => deleteDialog.openDialog(c),
        editButtonAriaLabel: (c) => `Editar combo ${c.nome}`,
        deleteButtonAriaLabel: (c) => `Excluir combo ${c.nome}`,
      });
      return {
        ...col,
        width: 'w-[5.5rem] max-lg:shrink-0 lg:w-[16%]',
        headerClassName: cn(col.headerClassName, 'max-lg:px-1'),
        cellClassName: cn(col.cellClassName, 'max-lg:px-1'),
      };
    })(),
  ];

  const total = ordered.length;

  const tableContent = accountMissing ? (
    <div className={cn(table.container, 'px-6 py-12 text-center text-gray-500')}>
      Conecte-se a uma conta para visualizar os combos cadastrados.
    </div>
  ) : (
        <div className={table.container} data-testid="combos-table">
      <DataTable
        columns={columns}
        data={paginated}
            loading={loading || userLoading}
        rowKey={(c) => c.id}
        skeletonRows={5}
        emptyMessage={
          <div className="px-6 py-12 text-center text-gray-500">Nenhum combo encontrado.</div>
        }
        ariaLabel="Tabela de combos"
      />
    </div>
  );

  return (
    <>
      <TableLayout
        title="Combos"
        subtitle="Agrupe turmas com regras e valores personalizados."
        actions={
          <Button
            onClick={openCreate}
            disabled={!contaId}
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" /> Novo combo
          </Button>
        }
        filtersBar={
          <EntityFiltersBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            onSearchEnter={handleSearch}
            statusValue={statusFilter}
            onStatusChange={(value) => setStatusFilter(value)}
            sortOrder={sort}
            onSortChange={(o) => setSort(o)}
            searchPlaceholder="Buscar por nome..."
          />
        }
        footer={<Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />}
      >
        {tableContent}
      </TableLayout>
      {contaId && (
        <ComboDialog
          open={dialogOpen}
          mode={dialogMode}
          contaId={contaId}
          combo={editing}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir combo"
        description={(() => {
          const nome = deleteDialog.entity?.nome ?? 'este combo';
          return (
            <span>
              Tem certeza que deseja excluir o combo <strong>{nome}</strong>? Esta ação é permanente
              e removerá definitivamente o registro.
            </span>
          );
        })()}
        confirmLabel={deleteDialog.loading ? 'Excluindo...' : 'Excluir'}
        cancelLabel="Cancelar"
        loadingLabel="Excluindo..."
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={async () => {
          try {
            await deleteDialog.confirm();
            toast.custom((t) => (
              <CustomToast
                variant="success"
                title="Combo excluído"
                description="O combo foi removido."
                onClose={() => toast.dismiss(t)}
              />
            ));
          } catch (err) {
            toast.custom((t) => (
              <CustomToast
                variant="error"
                title="Erro ao excluir"
                description={(err as Error).message}
                onClose={() => toast.dismiss(t)}
              />
            ));
          }
        }}
      />
    </>
  );
}

export default CombosFeature;
