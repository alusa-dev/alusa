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

  const columns: DataTableColumn<ComboListItem>[] = [
    {
      id: 'nome',
      header: 'Nome',
      width: 'w-1/3',
      align: 'left',
      render: (c) => (
        <div className={table.primaryText} title={c.nome}>
          <span className="font-medium text-gray-900 whitespace-normal break-words">{c.nome}</span>
        </div>
      ),
      skeleton: <div className="h-4 w-40 bg-gray-200 rounded" />,
    },
    {
      id: 'valor',
      header: 'Valor do Ciclo',
      width: 'w-32',
      align: 'right',
      render: (c) => (
        <span className="font-medium text-gray-900 whitespace-nowrap">
          {formatPlanoValorBRL(c.valor)}
        </span>
      ),
      skeleton: <div className="h-4 w-16 bg-gray-200 rounded ml-auto" />,
    },
    {
      id: 'periodicidade',
      header: 'Periodicidade',
      width: 'w-28',
      align: 'center',
      render: (c) => {
        const labels: Record<string, string> = {
          SEMANAL: 'Semanal',
          QUINZENAL: 'Quinzenal',
          MENSAL: 'Mensal',
          TRIMESTRAL: 'Trimestral',
          ANUAL: 'Anual',
        };
        return <span className="text-gray-700">{labels[c.periodicidade] ?? c.periodicidade}</span>;
      },
      skeleton: <div className="h-4 w-16 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'qtd',
      header: 'Qtd Turmas',
      width: 'w-24',
      align: 'center',
      render: (c) => c.turmas.length,
      skeleton: <div className="h-4 w-6 bg-gray-200 rounded mx-auto" />,
    },
    statusColumn<ComboListItem>({ activeLabel: 'Ativo', inactiveLabel: 'Inativo' }),
    actionsColumn<ComboListItem>({
      onEdit: (c) => openEdit(c),
      onDelete: (c) => deleteDialog.openDialog(c),
      editButtonAriaLabel: (c) => `Editar combo ${c.nome}`,
      deleteButtonAriaLabel: (c) => `Excluir combo ${c.nome}`,
    }),
  ];

  const total = ordered.length;

  const tableContent = accountMissing ? (
    <div className="bg-white rounded-xl border px-6 py-12 text-center text-gray-500">
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
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
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
