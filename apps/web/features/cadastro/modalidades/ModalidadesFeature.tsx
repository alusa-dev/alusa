'use client';

import { useEffect, useState } from 'react';
import TableLayout from '@/components/layout/TableLayout';
import { table } from '@/components/layout/TableStyles';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
// Removed explicit skeleton table; DataTable skeletons embutidos
import { Plus } from '@/components/icons/icons';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { useEditDialog } from '@/hooks/use-edit-dialog';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import useCurrentUser from '@/hooks/use-current-user';
import { formatFirstLast } from '@alusa/lib/client';
import ModalidadeDialog from '@/components/modalidades/ModalidadeDialog';
import {
  type ModalidadeListItem,
  type UpdateModalidadePayload,
  updateModalidade,
  createModalidade,
} from './services/modalidades-service';
import { useModalidades, type UseModalidadesFilters } from './hooks/use-modalidades';

const PAGE_SIZE = 10;

interface ModalidadesTableProps {
  modalidades: ModalidadeListItem[];
  accountMissing: boolean;
  onEdit: (_modalidade: ModalidadeListItem) => void;
  onDelete: (_modalidade: ModalidadeListItem) => void;
  loading: boolean;
}

export function ModalidadesFeature() {
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, reload, remove, setItems } = useModalidades({ contaId });
  const editDialog = useEditDialog<ModalidadeListItem>();
  const deleteDialog = useDeleteDialog<ModalidadeListItem>({
    onDelete: async (modalidade) => {
      if (!contaId) throw new Error('Conta não informada para exclusão.');
      await remove({ id: modalidade.id, contaId });
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  // creating state control handled inside dialog logic via absence/presence of editDialog.entity
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
  } = useEntityListFiltering<ModalidadeListItem>({
    items,
    nameAccessor: (modalidade) => modalidade.nome || '',
    statusAccessor: (modalidade) => (modalidade.status === 'INATIVO' ? 'INATIVO' : 'ATIVO'),
  });

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [setPageSize]);

  useEffect(() => {
    const handler = () => {
      void reload({ search: searchTerm, status: statusFilter });
    };
    window.addEventListener('modalidades:changed', handler);
    return () => window.removeEventListener('modalidades:changed', handler);
  }, [reload, searchTerm, statusFilter]);

  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);

  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  const handleSearch = () => {
    const filters: UseModalidadesFilters = {
      search: searchTerm,
      status: statusFilter,
    };
    void reload(filters);
  };

  const accountMissing = !contaId && !userLoading;

  return (
    <>
      <TableLayout
        title="Modalidades"
        subtitle="Gerencie cadastros e informações das modalidades."
        actions={
          <Button
            disabled={!contaId}
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
            onClick={() => {
              editDialog.closeDialog();
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Nova modalidade
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
            searchPlaceholder="Buscar por nome ou descrição..."
          />
        }
        footer={<Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />}
      >
        <div className={table.container}>
          <ModalidadesTable
            modalidades={paginated}
            accountMissing={accountMissing}
            onEdit={(modalidade) => editDialog.openDialog(modalidade)}
            onDelete={(modalidade) => deleteDialog.openDialog(modalidade)}
            loading={loading || userLoading}
          />
        </div>
      </TableLayout>

      <ModalidadeDialog
        open={dialogOpen || !!editDialog.entity}
        creating={!editDialog.entity}
        modalidade={editDialog.entity ?? null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDialogOpen(false);
            editDialog.closeDialog();
          } else {
            setDialogOpen(true);
          }
        }}
        onSubmit={async (formValues: { nome: string; descricao: string; status: string }) => {
          if (!contaId) {
            toast.custom((t) => (
              <CustomToast
                variant="error"
                title="Conta não encontrada"
                description="Não foi possível identificar a conta para salvar a modalidade."
                onClose={() => toast.dismiss(t)}
              />
            ));
            return;
          }

          // Create flow
          if (!editDialog.entity) {
            try {
              const created = await createModalidade({
                contaId,
                nome: formValues.nome.trim(),
                // Enviar undefined para compatibilidade com schema (evita 422)
                descricao: formValues.descricao.trim() || undefined,
                status: formValues.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
              });
              setItems((prev) => [created, ...prev]);
              toast.custom((t) => (
                <CustomToast
                  variant="success"
                  title="Modalidade criada"
                  description="A modalidade foi cadastrada."
                  onClose={() => toast.dismiss(t)}
                />
              ));
              setDialogOpen(false);
              window.dispatchEvent(new CustomEvent('modalidades:changed'));
              return;
            } catch (error) {
              toast.custom((t) => (
                <CustomToast
                  variant="error"
                  title="Erro ao salvar"
                  description={(error as Error).message}
                  onClose={() => toast.dismiss(t)}
                />
              ));
              throw error;
            }
          }

          // Update flow
          try {
            const current = editDialog.entity;
            if (!current) return;
            const payload = buildUpdatePayload(formValues, contaId);
            const updated = await updateModalidade({ id: current.id, payload });
            setItems((prev) =>
              prev.map((modalidade) =>
                modalidade.id === updated.id ? { ...modalidade, ...updated } : modalidade,
              ),
            );
            toast.custom((t) => (
              <CustomToast
                variant="success"
                title="Modalidade atualizada"
                description="As alterações foram salvas."
                onClose={() => toast.dismiss(t)}
              />
            ));
            editDialog.closeDialog();
            window.dispatchEvent(new CustomEvent('modalidades:changed'));
          } catch (error) {
            toast.custom((t) => (
              <CustomToast
                variant="error"
                title="Erro ao salvar"
                description={(error as Error).message}
                onClose={() => toast.dismiss(t)}
              />
            ));
            throw error;
          }
        }}
      />

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir modalidade"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Tem certeza que deseja excluir esta modalidade? Esta ação é permanente.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'esta modalidade';
          return (
            <span>
              Tem certeza que deseja excluir a modalidade <strong>{shortName}</strong>? Esta ação é
              permanente e não poderá ser desfeita.
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
                title="Modalidade excluída"
                description="A modalidade foi removida do sistema."
                onClose={() => toast.dismiss(t)}
              />
            ));
            window.dispatchEvent(new CustomEvent('modalidades:changed'));
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

function ModalidadesTable({
  modalidades,
  accountMissing,
  onEdit,
  onDelete,
  loading,
}: ModalidadesTableProps) {
  if (accountMissing) {
    return (
      <div className="px-6 py-12 text-center text-gray-500">
        Conecte-se a uma conta para visualizar as modalidades cadastradas.
      </div>
    );
  }

  const columns: DataTableColumn<ModalidadeListItem>[] = [
    {
      id: 'nome',
      header: 'Modalidade',
      width: 'w-1/4',
      align: 'left',
      render: (m) => (
        <div className="min-w-0">
          <div className={table.primaryText} title={m.nome}>
            {m.nome}
          </div>
        </div>
      ),
      skeleton: (
        <div className="space-y-2">
          <div className="h-4 w-48 bg-gray-200 rounded" />
          <div className="h-3 w-28 bg-gray-200 rounded" />
        </div>
      ),
    },
    {
      id: 'descricao',
      header: 'Descrição',
      width: 'w-1/4',
      align: 'left',
      render: (m) => (
        <div className="w-full min-w-0">
          {m.descricao?.trim() ? (
            <span className="block truncate" title={m.descricao}>
              {m.descricao}
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </div>
      ),
      skeleton: <div className="h-4 w-full bg-gray-200 rounded" />,
    },
    statusColumn<ModalidadeListItem>({
      activeLabel: 'Ativa',
      inactiveLabel: 'Inativa',
      getStatus: (modalidade: ModalidadeListItem) => modalidade.status,
    }),
    actionsColumn<ModalidadeListItem>({
      onEdit,
      onDelete,
      editButtonAriaLabel: (modalidade: ModalidadeListItem) =>
        `Editar modalidade ${modalidade.nome}`,
      deleteButtonAriaLabel: (modalidade: ModalidadeListItem) =>
        `Excluir modalidade ${modalidade.nome}`,
    }),
  ];

  return (
    <DataTable
      columns={columns}
      data={modalidades}
      rowKey={(m) => m.id}
      loading={loading}
      skeletonRows={5}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500">Nenhuma modalidade encontrada</div>
      }
      ariaLabel="Tabela de modalidades"
    />
  );
}

function buildUpdatePayload(
  raw: { nome: string; descricao: string; status: string },
  contaId?: string | null,
): UpdateModalidadePayload {
  if (!contaId) {
    throw new Error('Conta não encontrada para atualizar modalidade.');
  }

  const nome = raw.nome.trim();
  const descricao = raw.descricao.trim();

  const payload: UpdateModalidadePayload = {
    contaId,
    status: raw.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  };

  if (nome) payload.nome = nome;
  payload.descricao = descricao;

  return payload;
}

export default ModalidadesFeature;
