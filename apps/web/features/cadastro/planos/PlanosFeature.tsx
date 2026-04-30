'use client';

import { useCallback, useEffect, useState } from 'react';
import TableLayout from '@/components/layout/TableLayout';
import { table } from '@/components/layout/TableStyles';
import DataTable, { type DataTableColumn, type SortDirection } from '@/components/layout/DataTable';
import EntityFiltersBar from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/icons/icons';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import useCurrentUser from '@/hooks/use-current-user';
import PlanoDialog from '@/components/planos/PlanoDialog';
import {
  formatPlanoValorBRL,
  type PlanoListItem,
  type PlanoPeriodicidade,
} from './services/planos-service';
import { usePlanos, type UsePlanosFilters } from './hooks/use-planos';

const PAGE_SIZE = 10;

type WizardMode = 'create' | 'edit';

interface WizardState {
  open: boolean;
  mode: WizardMode;
  plano: PlanoListItem | null;
}

export function PlanosFeature() {
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, error, reload, remove } = usePlanos({ contaId });
  const deleteDialog = useDeleteDialog<PlanoListItem>({
    onDelete: async (plano) => {
      const targetContaId = contaId ?? plano.contaId;
      if (!targetContaId) throw new Error('Conta não informada para excluir plano.');
      await remove({ id: plano.id, contaId: targetContaId });
    },
  });

  const [dialogState, setDialogState] = useState<WizardState>({
    open: false,
    mode: 'create',
    plano: null,
  });

  const openCreateDialog = useCallback(() => {
    setDialogState({ open: true, mode: 'create', plano: null });
  }, []);

  const openEditDialog = useCallback((plano: PlanoListItem) => {
    setDialogState({ open: true, mode: 'edit', plano });
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState({ open: false, mode: 'create', plano: null });
  }, []);

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
  } = useEntityListFiltering<PlanoListItem>({
    items,
    nameAccessor: (plano) => plano.nome,
    statusAccessor: (plano) => plano.status,
  });

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [setPageSize]);

  useEffect(() => {
    if (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao carregar planos"
          description={error}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }, [error]);

  const handleSearch = () => {
    const filters: UsePlanosFilters = {
      search: searchTerm,
      status: statusFilter === 'TODOS' ? undefined : statusFilter,
    };
    void reload(filters);
  };

  const accountMissing = !contaId && !userLoading;

  return (
    <>
      <TableLayout
        title="Planos"
        subtitle="Gerencie os planos de cobrança da escola."
        actions={
          <Button
            data-testid="novo-plano"
            disabled={!contaId}
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
            onClick={openCreateDialog}
          >
            <Plus className="mr-2 h-4 w-4" /> Novo Plano
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
              const filters: UsePlanosFilters = {
                search: searchTerm,
                status: value === 'TODOS' ? undefined : value,
              };
              void reload(filters);
            }}
            sortOrder={sort}
            onSortChange={setSort}
            searchPlaceholder="Buscar por nome ou descrição..."
          />
        }
        footer={<Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />}
      >
        <PlanosTable
          data={paginated}
          accountMissing={accountMissing}
          loading={loading || userLoading}
          onEdit={openEditDialog}
          onDelete={deleteDialog.openDialog}
          sortDirection={sort as SortDirection}
        />
      </TableLayout>

      {contaId ? (
        <PlanoDialog
          open={dialogState.open}
          mode={dialogState.mode}
          contaId={contaId}
          plano={dialogState.plano}
          onOpenChange={(open: boolean) => {
            if (!open) closeDialog();
          }}
          onSuccess={() => {
            closeDialog();
            void reload();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir plano"
        description={(() => {
          const planoNome = deleteDialog.entity?.nome ?? 'este plano';
          return (
            <span>
              Tem certeza que deseja excluir o plano <strong>{planoNome}</strong>? Esta ação é
              permanente e removerá definitivamente o registro do sistema (não é possível recuperar
              depois).
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
                title="Plano excluído"
                description="O plano foi removido com sucesso."
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

interface PlanosTableProps {
  data: PlanoListItem[];
  accountMissing: boolean;
  loading: boolean;
  onEdit: (_plano: PlanoListItem) => void;
  onDelete: (_plano: PlanoListItem) => void;
  sortDirection: SortDirection;
}

function PlanosTable({ data, accountMissing, loading, onEdit, onDelete }: PlanosTableProps) {
  if (accountMissing) {
    return (
      <div className="bg-white rounded-xl border px-6 py-12 text-center text-gray-500">
        Conecte-se a uma conta para visualizar os planos cadastrados.
      </div>
    );
  }

  const columns: DataTableColumn<PlanoListItem>[] = [
    {
      id: 'nome',
      header: 'Plano',
      width: 'w-1/4',
      align: 'left',
      render: (p) => (
        <div className={table.primaryText} title={p.nome}>
          {p.nome}
        </div>
      ),
      skeleton: (
        <div className="space-y-2">
          <div className="h-4 w-40 bg-gray-200 rounded" />
        </div>
      ),
    },
    {
      id: 'descricao',
      header: 'Descrição',
      width: 'w-1/4',
      align: 'left',
      render: (p) => (
        <div className="w-full min-w-0">
          <span className="block truncate" title={p.descricao ?? ''}>
            {p.descricao?.trim() ? p.descricao : '-'}
          </span>
        </div>
      ),
      skeleton: <div className="h-4 w-full bg-gray-200 rounded" />,
    },
    {
      id: 'periodicidade',
      header: 'Periodicidade',
      width: 'w-1/6',
      align: 'center',
      render: (p) => formatPeriodicidade(p.periodicidade),
      skeleton: <div className="h-4 w-20 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'valor',
      header: 'Valor',
      width: 'w-24',
      align: 'right',
      render: (p) => (
        <span className="font-medium text-gray-900 whitespace-nowrap">
          {formatPlanoValorBRL(p.valor)}
        </span>
      ),
      skeleton: <div className="h-4 w-16 bg-gray-200 rounded ml-auto" />,
    },
    statusColumn<PlanoListItem>({
      activeLabel: 'Ativo',
      inactiveLabel: 'Inativo',
    }),
    actionsColumn<PlanoListItem>({
      onEdit,
      onDelete,
      editButtonAriaLabel: (plano: PlanoListItem) => `Editar plano ${plano.nome}`,
      deleteButtonAriaLabel: (plano: PlanoListItem) => `Excluir plano ${plano.nome}`,
    }),
  ];

  return (
    <div className={table.container} data-testid="planos-table">
      <DataTable
        columns={columns}
        data={data}
        rowKey={(p) => p.id}
        loading={loading}
        skeletonRows={5}
        emptyMessage={
          <div className="px-6 py-12 text-center text-gray-500">Nenhum plano encontrado.</div>
        }
        ariaLabel="Tabela de planos"
      />
    </div>
  );
}

function formatPeriodicidade(value: PlanoPeriodicidade) {
  const map: Record<string, string> = {
    SEMANAL: 'Semanal',
    QUINZENAL: 'Quinzenal',
    MENSAL: 'Mensal',
    TRIMESTRAL: 'Trimestral',
    ANUAL: 'Anual',
  };
  return map[value] || value;
}

export default PlanosFeature;
