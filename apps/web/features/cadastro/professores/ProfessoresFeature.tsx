'use client';

import { useEffect, useState } from 'react';
import EditEntityDialog from '@/components/dialogs/EditEntityDialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Edit3, Trash2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEditDialog } from '@/hooks/use-edit-dialog';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import useCurrentUser from '@/hooks/use-current-user';
import { formatFirstLast, maskPhone } from '@alusa/lib/client';
import { useProfessores, type UseProfessoresFilters } from './hooks/use-professores';
import {
  updateProfessor,
  type ProfessorListItem,
  type UpdateProfessorPayload,
} from './services/professores-service';

const PAGE_SIZE = 6;

interface ProfessoresTableProps {
  professores: ProfessorListItem[];
  accountMissing: boolean;
  onEdit: (_professor: ProfessorListItem) => void;
  onDelete: (_professor: ProfessorListItem) => void;
}

export function ProfessoresFeature() {
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, reload, remove, setItems } = useProfessores({ contaId });
  const editDialog = useEditDialog<ProfessorListItem>();
  const deleteDialog = useDeleteDialog<ProfessorListItem>({
    onDelete: async (professor) => {
      if (!contaId) throw new Error('Conta não informada para exclusão.');
      await remove({ id: professor.id, contaId });
    },
  });

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
  } = useEntityListFiltering<ProfessorListItem>({
    items,
    nameAccessor: (professor) => professor.nome || '',
    statusAccessor: (professor) => (professor.status === 'INATIVO' ? 'INATIVO' : 'ATIVO'),
    searchPredicate: (professor, term, digits) => {
      if (!term && !digits) return true;
      const nome = (professor.nome || '').toLowerCase();
      const email = (professor.email || '').toLowerCase();
      const telefoneDigits = (professor.telefoneCel || '').replace(/\D/g, '');
      return (
        (!!term && (nome.includes(term) || email.includes(term))) ||
        (!!digits && telefoneDigits.includes(digits))
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
    window.addEventListener('professores:changed', handler);
    return () => window.removeEventListener('professores:changed', handler);
  }, [reload, searchTerm, statusFilter]);

  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);

  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  const handleSearch = () => {
    const filters: UseProfessoresFilters = {
      search: searchTerm,
      status: statusFilter,
    };
    void reload(filters);
  };

  const accountMissing = !contaId && !userLoading;

  return (
    <TableLayout
      title="Professores"
      subtitle="Gerencie cadastros e informações dos professores."
      actions={
        <Button
          disabled={!contaId}
          className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
        >
          <Plus className="h-4 w-4 mr-2" /> Novo professor
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
          searchPlaceholder="Buscar por nome ou email..."
        />
      }
    >
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading || userLoading ? (
          <ProfessoresSkeleton />
        ) : (
          <ProfessoresTable
            professores={paginated}
            accountMissing={accountMissing}
            onEdit={(professor) => {
              editDialog.openDialog(professor);
            }}
            onDelete={(professor) => {
              deleteDialog.openDialog(professor);
            }}
          />
        )}
        {total > pageSize ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />
          </div>
        ) : null}
      </div>

      {editDialog.entity ? (
        <EditEntityDialog
          open={editDialog.open}
          title="Editar professor"
          description="Atualize os dados do professor."
          fields={[
            {
              name: 'nome',
              label: 'Nome',
              initialValue: editDialog.entity.nome,
              validate: (value) => (!String(value).trim() ? 'Informe o nome' : null),
            },
            {
              name: 'email',
              label: 'E-mail',
              initialValue: editDialog.entity.email ?? '',
              readOnly: true,
            },
            {
              name: 'telefoneCel',
              label: 'Telefone',
              initialValue: editDialog.entity.telefoneCel ?? '',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              initialValue: editDialog.entity.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
              options: [
                { value: 'ATIVO', label: 'Ativo' },
                { value: 'INATIVO', label: 'Inativo' },
              ],
            },
          ]}
          onBuildPayload={(raw) => buildUpdatePayload(raw, contaId)}
          onSubmit={async (payload) => {
            if (!editDialog.entity) return;
            try {
              const updated = await updateProfessor({ id: editDialog.entity.id, payload });
              setItems((prev) =>
                prev.map((professor) =>
                  professor.id === updated.id ? { ...professor, ...updated } : professor,
                ),
              );
              toast.custom((t) => (
                <CustomToast
                  variant="success"
                  title="Professor atualizado"
                  description="Alterações salvas."
                  onClose={() => toast.dismiss(t)}
                />
              ));
              editDialog.closeDialog();
              window.dispatchEvent(new CustomEvent('professores:changed'));
            } catch (error) {
              toast.custom((t) => (
                <CustomToast
                  variant="error"
                  title="Erro ao salvar"
                  description={(error as Error).message}
                  onClose={() => toast.dismiss(t)}
                />
              ));
            }
          }}
          onOpenChange={(open) => {
            if (!open) editDialog.closeDialog();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir professor"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Tem certeza que deseja excluir este professor? Esta ação não pode ser desfeita.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'este professor';
          return (
            <span>
              Tem certeza que deseja excluir o professor <strong>{shortName}</strong>? Esta ação não
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
                title="Professor excluído"
                description="O professor foi removido."
                onClose={() => toast.dismiss(t)}
              />
            ));
            window.dispatchEvent(new CustomEvent('professores:changed'));
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
    </TableLayout>
  );
}

function ProfessoresSkeleton() {
  return (
    <>
      <div className="bg-gray-50 px-6 py-3 border-b">
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-4 h-4" />
          <Skeleton className="col-span-3 h-4" />
          <Skeleton className="col-span-3 h-4" />
          <Skeleton className="col-span-1 h-4" />
          <Skeleton className="col-span-1 h-4" />
        </div>
      </div>
      {[...Array(5)].map((_, index) => (
        <div key={index} className="px-6 py-3">
          <div className="grid grid-cols-12 gap-4 items-center">
            <Skeleton className="col-span-4 h-4" />
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-1 h-6 w-12" />
            <Skeleton className="col-span-1 h-8 w-8" />
          </div>
        </div>
      ))}
    </>
  );
}

function ProfessoresTable({
  professores,
  accountMissing,
  onEdit,
  onDelete,
}: ProfessoresTableProps) {
  if (accountMissing) {
    return (
      <div className="px-6 py-12 text-center text-gray-500">
        Conecte-se a uma conta para visualizar os professores cadastrados.
      </div>
    );
  }

  if (professores.length === 0) {
    return <div className="px-6 py-12 text-center text-gray-500">Nenhum professor encontrado</div>;
  }

  return (
    <>
      <div className="bg-gray-50 px-6 py-3 border-b">
        <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
          <div className="col-span-4">Nome</div>
          <div className="col-span-3 text-center">E-mail</div>
          <div className="col-span-3 text-center">Telefone</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-1 text-center">Ações</div>
        </div>
      </div>
      <div className="divide-y">
        {professores.map((professor) => (
          <div key={professor.id} className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white">
            <div className="grid grid-cols-12 gap-4 items-center">
              <div className="col-span-4 text-[13px] text-gray-900 truncate">{professor.nome}</div>
              <div
                className="col-span-3 text-[13px] text-gray-700 text-center truncate"
                title={professor.email || ''}
              >
                {professor.email || '-'}
              </div>
              <div className="col-span-3 text-[13px] text-gray-700 text-center">
                {professor.telefoneCel ? maskPhone(professor.telefoneCel) : '-'}
              </div>
              <div className="col-span-1 flex justify-center">
                <Badge status={professor.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />
              </div>
              <div className="col-span-1 flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                  aria-label="Editar professor"
                  onClick={() => onEdit(professor)}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                  aria-label="Excluir professor"
                  onClick={() => onDelete(professor)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function buildUpdatePayload(
  raw: Record<string, unknown>,
  contaId?: string | null,
): UpdateProfessorPayload {
  const nome = String(raw.nome ?? '').trim();
  const emailRaw = String(raw.email ?? '').trim();
  const telefoneRaw = String(raw.telefoneCel ?? '').trim();
  const statusRaw = String(raw.status ?? 'ATIVO');

  if (!contaId) {
    throw new Error('Conta não encontrada para atualizar professor.');
  }

  const payload: UpdateProfessorPayload = {
    contaId,
    ...(nome ? { nome } : {}),
    status: statusRaw === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  };

  if (emailRaw) payload.email = emailRaw;
  if (telefoneRaw) payload.telefoneCel = telefoneRaw;

  return payload;
}

export default ProfessoresFeature;
