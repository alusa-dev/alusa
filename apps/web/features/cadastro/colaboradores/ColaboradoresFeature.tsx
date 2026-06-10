'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
// Input/Select removidos em favor de EntityFiltersBar
import { Badge, type StatusType } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
// Skeleton manual substituído pelos skeletons do DataTable
import { Plus } from '@/components/icons/icons';
// Dropdown de ordenação incorporado no EntityFiltersBar
import ColaboradorWizardDialog from '@/components/colaboradores/ColaboradorWizardDialog';
import ColaboradorEditDialog, {
  type ColaboradorEdit,
} from '@/components/colaboradores/ColaboradorEditDialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import ReasonField from '@/components/shared/ReasonField';
import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import EntityFiltersBar, {
  type StatusValue,
  type SortOrder as SortOrderEF,
} from '@/components/layout/EntityFiltersBar';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEditDialog } from '@/hooks/use-edit-dialog';
import { useColaboradores } from './hooks/use-colaboradores';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import type { ColaboradorListItem } from './services/colaboradores-service';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { table } from '@/components/layout/TableStyles';
import { formatFirstLast, formatInitials, maskCpf, maskPhone } from '@alusa/lib/client';
import { cn } from '@/lib/utils';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import { toast } from '@/components/ui/toast';
import useCurrentUser from '@/hooks/use-current-user';

const PAGE_SIZE = 6;

type SortOrder = 'ASC' | 'DESC';
type StatusFilter = StatusValue;

const colaboradorCargoStatusMap: Partial<Record<string, StatusType>> = {
  ADMIN: 'ADMIN',
  PROFESSOR: 'PROFESSOR',
  INSTRUTOR: 'INSTRUTOR',
  RECEPCAO: 'RECEPCAO',
  RECEPCIONISTA: 'RECEPCIONISTA',
  SECRETARIA: 'SECRETARIA',
  GERENTE: 'GERENTE',
  FINANCEIRO: 'FINANCEIRO',
  RESPONSAVEL: 'RESPONSAVEL',
  ADMINISTRATIVO: 'ADMINISTRATIVO',
  OUTRO: 'OUTRO',
};

function resolveColaboradorCargoBadge(cargo: string | null | undefined):
  | { status: StatusType; label?: undefined }
  | { status?: undefined; label: string } {
  const normalized = String(cargo ?? 'OUTRO').trim().toUpperCase();
  const mappedStatus = colaboradorCargoStatusMap[normalized];

  if (mappedStatus) {
    return { status: mappedStatus };
  }

  return { label: String(cargo ?? '-').trim() || '-' };
}

export function ColaboradoresFeature() {
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, reload, remove } = useColaboradores({ contaId });
  const editDialog = useEditDialog<ColaboradorEdit>();
  const deleteDialog = useDeleteDialog<ColaboradorListItem>({
    onDelete: async (colaborador, reason) => {
      await remove({ id: colaborador.id, reason });
      try {
        window.dispatchEvent(new CustomEvent('colaboradores:changed'));
      } catch {
        /* noop */
      }
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
    ordered,
    paginated,
    resetFilters,
  } = useEntityListFiltering<ColaboradorListItem>({
    items,
    nameAccessor: (c) => c.nome ?? '',
    statusAccessor: (c) => (c.status as StatusFilter) ?? 'ATIVO',
    searchPredicate: (c, term, digits) => {
      const nome = (c.nome || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const cpfDigits = (c.cpf || '').replace(/\D/g, '');
      const matchNome = nome.includes(term);
      const matchEmail = email.includes(term);
      const matchCpf = Boolean(digits && cpfDigits.includes(digits));
      return matchNome || matchEmail || matchCpf;
    },
    initialSort: 'ASC',
  });
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      void reload();
    };
    window.addEventListener('colaboradores:changed', handler);
    return () => window.removeEventListener('colaboradores:changed', handler);
  }, [reload]);

  // Sincroniza sort local (para compatibilidade com EntityFiltersBar) com hook
  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);
  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  return (
    <TableLayout
      title="Gestão de Colaboradores"
      subtitle="Gerencie cadastros, status e informações dos colaboradores."
      actions={
        <>
          <Button
            onClick={() => setWizardOpen(true)}
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
            aria-label="Cadastrar colaborador"
            disabled={!contaId}
          >
            <Plus className="h-4 w-4 mr-2 transition-none" />
            Novo colaborador
          </Button>
        </>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          statusValue={statusFilter}
          onStatusChange={(v) => setStatusFilter(v as StatusFilter)}
          sortOrder={sortOrder as SortOrderEF}
          onSortChange={(o) => setSortOrder(o as SortOrder)}
          searchPlaceholder="Buscar por nome..."
        />
      }
    >
      <div className={table.container}>
        <ColaboradoresTable
          colaboradores={paginated}
          onEdit={(colaborador) => {
            editDialog.openDialog(mapToColaboradorEdit(colaborador));
          }}
          onDelete={(colaborador) => {
            deleteDialog.openDialog(colaborador);
          }}
          loading={loading || userLoading}
        />
        {ordered.length > PAGE_SIZE ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={ordered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        ) : null}
      </div>

      <ColaboradorWizardDialog
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) void reload();
        }}
        onFinish={() => {
          resetFilters();
          void reload();
        }}
        contaId={contaId ?? undefined}
      />

      <ColaboradorEditDialog
        open={editDialog.open}
        onOpenChange={(open) => {
          editDialog.onOpenChange(open);
          if (!open) void reload();
        }}
        mode={editDialog.entity ? 'edit' : 'create'}
        colaborador={editDialog.entity}
        contaId={contaId ?? undefined}
        onSaved={() => {
          editDialog.closeDialog();
          void reload();
        }}
      />

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir colaborador"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Tem certeza que deseja excluir este colaborador? Esta ação não pode ser desfeita.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'este colaborador';
          return (
            <span>
              Tem certeza que deseja excluir o colaborador <strong>{shortName}</strong>? Esta ação
              não pode ser desfeita.
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
            toast.success('Colaborador excluído');
            await reload();
          } catch (error) {
            toast.error((error as Error).message || 'Erro ao excluir colaborador');
          }
        }}
      >
        <ReasonField
          id="colaborador-delete-reason"
          value={deleteDialog.reason}
          onChange={(event) => deleteDialog.setReason(event.target.value)}
        />
      </ConfirmDeleteDialog>
    </TableLayout>
  );
}

function ColaboradoresTable({
  colaboradores,
  onEdit,
  onDelete,
  loading,
}: {
  colaboradores: ColaboradorListItem[];
  onEdit: (_colaborador: ColaboradorListItem) => void;
  onDelete: (_colaborador: ColaboradorListItem) => void;
  loading: boolean;
}) {
  const columns: DataTableColumn<ColaboradorListItem>[] = [
    {
      id: 'colaborador',
      header: 'Colaborador',
      width: 'min-w-0 lg:w-[22%]',
      noWrap: false,
      align: 'left',
      skeleton: (
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="h-9 w-9 rounded-full bg-gray-200 lg:h-10 lg:w-10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-28 rounded bg-gray-200 lg:hidden" />
            <div className="flex gap-2">
              <div className="h-4 w-12 rounded bg-gray-200" />
              <div className="h-4 w-16 rounded bg-gray-200" />
            </div>
          </div>
        </div>
      ),
      render: (colaborador) => {
        const initials = formatInitials(colaborador.nome ?? '');
        const badge = resolveColaboradorCargoBadge(colaborador.cargo);
        const cargoLabel = badge.status ? undefined : badge.label;
        return (
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Avatar className="h-9 w-9 shrink-0 lg:h-10 lg:w-10">
              {colaborador.foto ? (
                <AvatarImage
                  src={colaborador.foto}
                  alt={colaborador.nome ?? ''}
                  draggable={false}
                  onError={(event) => {
                    const el = event.currentTarget as HTMLImageElement;
                    el.style.display = 'none';
                  }}
                />
              ) : null}
              <AvatarFallback className="bg-purple-100 font-medium text-purple-700">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[13px] font-normal text-gray-900"
                data-testid={`colaborador-nome-${colaborador.id}`}
              >
                {colaborador.nome}
              </div>
              <div className="mt-0.5 text-[12px] tabular-nums leading-snug text-gray-500 lg:hidden">
                {colaborador.cpf ? maskCpf(colaborador.cpf) : '—'}
              </div>
              {(cargoLabel || colaborador.especialidade) && (
                <div className="mt-0.5 text-[11px] leading-snug text-gray-500 lg:hidden">
                  {[cargoLabel, colaborador.especialidade].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="mt-1 hidden flex-wrap gap-1 lg:flex">
                {colaborador.especialidade && (
                  <Badge variant="default" size="sm">
                    {colaborador.especialidade}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'cpf',
      header: 'CPF',
      width: 'lg:w-[11%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => (
        <span className="tabular-nums leading-[20px]">{c.cpf ? maskCpf(c.cpf) : '-'}</span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'email',
      header: 'E-mail',
      width: 'lg:w-[22%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      noWrap: false,
      render: (c) => (
        <span
          className="inline-block max-w-full truncate leading-[20px]"
          title={c.email ?? undefined}
        >
          {c.email ?? '-'}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-40 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'telefone',
      header: 'Telefone',
      width: 'lg:w-[13%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => (
        <span className="tabular-nums leading-[20px]">{maskPhone(c.telefone1) || '-'}</span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'funcao',
      header: 'Função',
      width: 'lg:w-[10%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (c) => {
        const badge = resolveColaboradorCargoBadge(c.cargo);

        if (badge.status) {
          return <Badge status={badge.status} size="sm" />;
        }

        return (
          <Badge variant="neutral" size="sm">
            {badge.label}
          </Badge>
        );
      },
      skeleton: <div className="mx-auto hidden h-4 w-16 rounded bg-gray-200 lg:block" />,
    },
    (() => {
      const col = statusColumn<ColaboradorListItem>({
        render: (c) => <Badge status={c.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />,
      });
      return {
        ...col,
        width: 'w-[4.5rem] max-lg:shrink-0 max-lg:whitespace-nowrap lg:w-[12%]',
        cellClassName: cn(col.cellClassName, 'align-middle'),
      };
    })(),
    (() => {
      const col = actionsColumn<ColaboradorListItem>({
        onEdit,
        onDelete,
        editButtonAriaLabel: (c) => `Editar colaborador ${c.nome ?? ''}`,
        deleteButtonAriaLabel: (c) => `Excluir colaborador ${c.nome ?? ''}`,
      });
      return {
        ...col,
        width: 'w-[5.5rem] max-lg:shrink-0 lg:w-[10%]',
        headerClassName: cn(col.headerClassName, 'max-lg:px-1'),
        cellClassName: cn(col.cellClassName, 'max-lg:px-1'),
      };
    })(),
  ];

  return (
    <DataTable
      columns={columns}
      data={colaboradores}
      rowKey={(c) => c.id}
      loading={loading}
      skeletonRows={5}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500">Nenhum colaborador encontrado</div>
      }
      ariaLabel="Tabela de colaboradores"
    />
  );
}

// (Pagination e IconButton locais removidos; usando componente compartilhado.)

function mapToColaboradorEdit(colaborador: ColaboradorListItem): ColaboradorEdit {
  return {
    id: colaborador.id,
    nome: colaborador.nome ?? '',
    nomeSocial: null,
    foto: colaborador.foto ?? null,
    dataNasc: null,
    genero: null,
    cpf: colaborador.cpf ?? null,
    rg: null,
    orgaoEmissor: null,
    dataEmissao: null,
    email: colaborador.email ?? null,
    telefone1: colaborador.telefone1 ?? null,
    contatoEmergenciaTelefone: null,
    enderecoCep: null,
    enderecoLogradouro: null,
    enderecoNumero: null,
    enderecoComplemento: null,
    enderecoBairro: null,
    enderecoCidade: null,
    enderecoUf: null,
    cargo: (colaborador.cargo as ColaboradorEdit['cargo']) ?? 'OUTRO',
    especialidade: colaborador.especialidade ?? null,
    status: colaborador.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    dataAdmissao: null,
    dataDesligamento: null,
    observacoes: null,
    salario: null,
    temAcesso: null,
    roleUsuario: '',
  };
}

export default ColaboradoresFeature;
