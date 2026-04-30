'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
// Input/Select removidos em favor de EntityFiltersBar
import { Badge, type StatusType } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
// Skeleton manual substituído pelos skeletons do DataTable
import { Trash2, Plus, Edit3, Eye, EyeOff } from '@/components/icons/icons';
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
import { formatFirstLast, formatInitials, maskCpf } from '@alusa/lib/client';
import { toast } from '@/components/ui/toast';
import useCurrentUser from '@/hooks/use-current-user';

const PAGE_SIZE = 10;

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

  const [hideSensitive, setHideSensitive] = useState(false);
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

  const shouldBlur = (value: string | null | undefined) =>
    Boolean(hideSensitive && value && value !== '-');
  const blurClass = 'inline-block filter blur-[3px] px-1 -mx-1 py-0.5 -my-0.5 leading-[20px]';

  return (
    <TableLayout
      title="Gestão de Colaboradores"
      subtitle="Gerencie cadastros, status e informações dos colaboradores."
      actions={
        <>
          <Button
            onClick={() => setWizardOpen(true)}
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
            aria-label="Cadastrar colaborador"
            disabled={!contaId}
          >
            <Plus className="h-4 w-4 mr-2 transition-none" />
            Novo colaborador
          </Button>
          <Button
            variant="outline"
            onClick={() => setHideSensitive((v) => !v)}
            className="h-10 px-4 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-none [&_svg]:transition-none"
            title={
              hideSensitive ? 'Mostrar CPF, e-mail e telefone' : 'Ocultar CPF, e-mail e telefone'
            }
            aria-pressed={hideSensitive}
          >
            {hideSensitive ? (
              <>
                <Eye className="h-4 w-4 mr-2 transition-none" />
                Mostrar dados
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-2 transition-none" />
                Ocultar dados
              </>
            )}
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
      footer={
        <Pagination total={ordered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
      }
    >
      <div className="bg-white rounded-xl border overflow-hidden">
        <ColaboradoresTable
          colaboradores={paginated}
          shouldBlur={shouldBlur}
          blurClass={blurClass}
          onEdit={(colaborador) => {
            editDialog.openDialog(mapToColaboradorEdit(colaborador));
          }}
          onDelete={(colaborador) => {
            deleteDialog.openDialog(colaborador);
          }}
          loading={loading || userLoading}
        />
      </div>

      {/* Paginação movida para footer do TableLayout */}
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
  shouldBlur,
  blurClass,
  onEdit,
  onDelete,
  loading,
}: {
  colaboradores: ColaboradorListItem[];
  shouldBlur: (_value: string | null | undefined) => boolean;
  blurClass: string;
  onEdit: (_colaborador: ColaboradorListItem) => void;
  onDelete: (_colaborador: ColaboradorListItem) => void;
  loading: boolean;
}) {
  const columns: DataTableColumn<ColaboradorListItem>[] = [
    {
      id: 'colaborador',
      header: 'Colaborador',
      width: 'w-[22%]',
      noWrap: false,
      align: 'left',
      skeleton: (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 bg-gray-200 rounded" />
            <div className="flex gap-2">
              <div className="h-4 w-12 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      ),
      render: (colaborador) => {
        const initials = formatInitials(colaborador.nome ?? '');
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10">
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
              <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div
                className="font-normal text-gray-900 text-[13px] truncate"
                data-testid={`colaborador-nome-${colaborador.id}`}
              >
                {colaborador.nome}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
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
      width: 'w-[11%]',
      align: 'center',
      render: (c) => {
        const cpfMasked = maskCpf(c.cpf ?? '');
        return (
          <span className={shouldBlur(c.cpf) ? blurClass : 'leading-[20px]'}>
            {c.cpf ? cpfMasked : '-'}
          </span>
        );
      },
      skeleton: <div className="h-4 w-24 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'email',
      header: 'E-mail',
      width: 'w-[22%]',
      align: 'center',
      noWrap: false,
      render: (c) =>
        shouldBlur(c.email) ? (
          <span className={blurClass}>{c.email ?? '-'}</span>
        ) : (
          <span className="inline-block max-w-full truncate leading-[20px]" title={c.email ?? ''}>
            {c.email ?? '-'}
          </span>
        ),
      skeleton: <div className="h-4 w-40 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'telefone',
      header: 'Telefone',
      width: 'w-[13%]',
      align: 'center',
      render: (c) => (
        <span className={shouldBlur(c.telefone1) ? blurClass : 'leading-[20px]'}>
          {c.telefone1 || '-'}
        </span>
      ),
      skeleton: <div className="h-4 w-24 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'funcao',
      header: 'Função',
      width: 'w-[10%]',
      align: 'center',
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
      skeleton: <div className="h-4 w-16 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[12%]',
      align: 'center',
      render: (c) => <Badge status={c.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />,
      skeleton: <div className="h-6 w-14 bg-gray-200 rounded-full mx-auto" />,
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[10%]',
      align: 'center',
      render: (c) => (
        <div className="flex justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            aria-label="Editar colaborador"
            onClick={() => onEdit(c)}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            aria-label="Excluir colaborador"
            onClick={() => onDelete(c)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      skeleton: (
        <div className="flex justify-center gap-2">
          <div className="h-8 w-8 bg-gray-200 rounded" />
          <div className="h-8 w-8 bg-gray-200 rounded" />
        </div>
      ),
    },
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
