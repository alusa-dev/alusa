'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
// (Busca agora controlada pelo EntityFiltersBar; Input removido)
// Removido select custom inline (usaremos EntityFiltersBar)
import { Badge } from '@/components/ui/badge';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
// Skeleton manual substituído pelos skeletons do DataTable
import { Plus, RotateCcw, Trash2 } from '@/components/icons/icons';
// Dropdown de ordenação substituído pelo EntityFiltersBar
import dynamic from 'next/dynamic';

const StudentRegistrationWizard = dynamic(() => import('./components/StudentRegistrationWizard'), {
  ssr: false,
});
import { StudentEditDialog, type EditAluno } from '@/features/students/components/StudentEditDialog';
import ActionConfirmationDialog from '@/components/dialogs/ActionConfirmationDialog';
import ReasonField from '@/components/shared/ReasonField';
import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import EntityFiltersBar, {
  type StatusValue,
  type SortOrder as SortOrderEF,
} from '@/components/layout/EntityFiltersBar';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { formatFirstLast, maskCpf, maskPhone } from '@alusa/lib/client';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEditDialog } from '@/hooks/use-edit-dialog';
import useCurrentUser from '@/hooks/use-current-user';
import { useAlunos } from './hooks/use-students';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import { reactivateAluno, type AlunoListItem } from './services/students-service';
import { pushToast } from '@/components/ui/toast';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';
import { usePlatformBillingWriteAccess } from '@/hooks/use-platform-billing-write-access';

const PAGE_SIZE = 6;

type SortOrder = 'ASC' | 'DESC';
type StatusFilter = StatusValue;

interface AlunosTableProps {
  alunos: AlunoListItem[];
  onEdit: (_aluno: AlunoListItem) => void;
  onDelete: (_aluno: AlunoListItem) => void;
  onReactivate: (_aluno: AlunoListItem) => void;
  onOpenDetail: (_aluno: AlunoListItem) => void;
  canWrite: boolean;
  loading: boolean;
}

// Paginação unificada via componente compartilhado

export function AlunosFeature() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;
  const { canWrite, loading: billingLoading } = usePlatformBillingWriteAccess();
  const isBillingWriteBlocked = billingLoading || !canWrite;

  const {
    search: searchTerm,
    setSearch: setSearchTerm,
    status: statusFilter,
    setStatus: setStatusFilter,
    sort,
    setSort,
    resetFilters,
  } = useEntityListFiltering({
    items: [],
    nameAccessor: (a: AlunoListItem) => a.nome ?? '',
    statusAccessor: (a: AlunoListItem) => (a.status as StatusFilter) ?? 'ATIVO',
    searchPredicate: () => true,
    initialStatus: 'ATIVO',
    initialSort: 'ASC',
  });

  const { items, total, loading, reload, remove, page, setPage } = useAlunos({
    contaId,
    q: searchTerm,
    status: statusFilter,
    pageSize: PAGE_SIZE,
    sortOrder: sort as SortOrder,
  });
  const handleReactivate = useCallback(async (aluno: AlunoListItem) => {
    if (!canWrite) return;
    try {
      await reactivateAluno(aluno.id);
      pushToast({ title: 'Aluno reativado', variant: 'success' });
      await reload();
      window.dispatchEvent(new CustomEvent('alunos:changed'));
    } catch (error) {
      pushToast({
        title: 'Não foi possível reativar',
        description: (error as Error).message,
        variant: 'error',
      });
    }
  }, [canWrite, reload]);
  const editDialog = useEditDialog<EditAluno>();
  const deleteDialog = useDeleteDialog<AlunoListItem>({
    onDelete: async (aluno, reason) => {
      await remove({ id: aluno.id, reason });
      window.dispatchEvent(new CustomEvent('alunos:changed'));
    },
  });

  const refresh = useCallback(() => {
    void reload();
  }, [reload]);

  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');
  const [wizardOpen, setWizardOpen] = useState(false);
  const editRequestId = useRef(0);
  const openEditDialog = editDialog.openDialog;

  const handleEditAluno = useCallback(async (aluno: AlunoListItem) => {
    const requestId = ++editRequestId.current;
    try {
      const details = await fetchAlunoDetails(aluno.id);
      if (requestId === editRequestId.current) openEditDialog(details);
    } catch (error) {
      if (requestId !== editRequestId.current) return;
      pushToast({
        title: 'Não foi possível carregar os dados do aluno',
        description: (error as Error).message || 'Tente novamente.',
        variant: 'error',
      });
    }
  }, [openEditDialog]);

  useEffect(() => {
    const handler = () => {
      refresh();
    };
    window.addEventListener('alunos:changed', handler);
    return () => window.removeEventListener('alunos:changed', handler);
  }, [refresh]);

  // Manter sortOrder sincronizado para compatibilidade existente
  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);
  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  const handleOpenWizard = useCallback(() => {
    if (!contaId || isBillingWriteBlocked) return;
    setWizardOpen(true);
  }, [contaId, isBillingWriteBlocked]);

  return (
    <TableLayout
      title="Gestão de Alunos"
      subtitle="Gerencie cadastros, status e informações dos alunos."
      actions={
        <>
          <Button
            onClick={handleOpenWizard}
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
            aria-label="Cadastrar aluno"
            data-testid="abrir-wizard-aluno"
            disabled={!contaId || isBillingWriteBlocked}
            title={isBillingWriteBlocked ? 'Regularize o plano para cadastrar alunos.' : undefined}
          >
            <Plus className="h-4 w-4 mr-2 transition-none" />
            Cadastrar aluno
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
      <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
        <AlunosTable
          alunos={items}
          onEdit={(aluno) => void handleEditAluno(aluno)}
          onDelete={(aluno) => {
            if (aluno.status === 'INATIVO') {
              void handleReactivate(aluno);
              return;
            }
            deleteDialog.openDialog(aluno);
          }}
          onReactivate={handleReactivate}
          onOpenDetail={(aluno) => router.push(`/students/${aluno.id}`)}
          canWrite={canWrite}
          loading={loading || userLoading}
        />
        {total > PAGE_SIZE ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={total} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        ) : null}
      </div>

      <StudentRegistrationWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) refresh();
        }}
        onFinish={() => {
          resetFilters();
          refresh();
        }}
        contaId={contaId ?? undefined}
      />

      <StudentEditDialog
        open={editDialog.open}
        onOpenChange={(open) => {
          editDialog.onOpenChange(open);
          if (!open) refresh();
        }}
        aluno={editDialog.entity}
        onSaved={() => {
          editDialog.closeDialog();
          refresh();
        }}
      />

      <ActionConfirmationDialog
        open={deleteDialog.open}
        title="Remover aluno"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Com histórico ou vínculos, o cadastro será arquivado.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'este aluno';
          return (
            <span>
              Remover <strong>{shortName}</strong>? Se houver histórico, o cadastro será arquivado.
            </span>
          );
        })()}
        confirmLabel={deleteDialog.loading ? 'Processando...' : 'Confirmar'}
        loadingLabel="Processando..."
        cancelLabel="Cancelar"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={async () => {
          try {
            await deleteDialog.confirm();
            pushToast({
              title: 'Operação concluída',
              variant: 'success',
            });
          } catch (error) {
            pushToast({
              title: 'Não foi possível excluir',
              description: (error as Error).message || 'Erro ao excluir aluno',
              variant: 'error',
            });
          }
        }}
      >
        <ReasonField
          id="aluno-delete-reason"
          value={deleteDialog.reason}
          onChange={(event) => deleteDialog.setReason(event.target.value)}
        />
      </ActionConfirmationDialog>
    </TableLayout>
  );
}

function AlunosTable({
  alunos,
  onEdit,
  onDelete,
  onReactivate,
  onOpenDetail,
  canWrite,
  loading,
}: AlunosTableProps) {
  const columns: DataTableColumn<AlunoListItem>[] = [
    {
      id: 'aluno',
      header: 'Aluno',
      width: 'min-w-0 lg:w-[26%]',
      align: 'left',
      noWrap: false,
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
      render: (aluno) => {
        return (
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <PersonAvatar
              name={aluno.nome ?? ''}
              src={aluno.avatarUrl ?? aluno.foto}
              size="md"
              className="h-9 w-9 lg:h-10 lg:w-10"
            />
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[13px] font-normal text-gray-900"
                data-testid={`aluno-nome-${aluno.id}`}
              >
                {aluno.nome}
              </div>
              <div className="mt-0.5 text-[12px] tabular-nums leading-snug text-gray-500 lg:hidden">
                {aluno.cpfMasked ?? (aluno.cpf ? maskCpf(aluno.cpf) : '—')}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {aluno.isentoTaxaMatricula && (
                  <Badge status="ISENTO" size="sm" />
                )}
                {aluno.bolsaDescontoPercent && Number(aluno.bolsaDescontoPercent) > 0 && (
                  <Badge
                    variant="success"
                    className="text-[10px] font-bold tracking-widest uppercase"
                  >
                    Bolsa {aluno.bolsaDescontoPercent}%
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
      width: 'lg:w-[14%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (aluno) => (
        <span className="tabular-nums leading-[20px]">
          {aluno.cpfMasked ?? (aluno.cpf ? maskCpf(aluno.cpf) : '-')}
        </span>
      ),
      skeleton: <div className="hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'email',
      header: 'E-mail',
      width: 'lg:w-[24%]',
      align: 'left',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (aluno) => (
        <span
          className="inline-block max-w-full truncate leading-[20px]"
          title={aluno.email ?? undefined}
        >
          {aluno.email ?? '-'}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-40 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'telefone',
      header: 'Telefone',
      width: 'lg:w-[14%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (aluno) => (
        <span className="tabular-nums leading-[20px]">
          {maskPhone(aluno.telefone) || '-'}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    (() => {
      const col = statusColumn<AlunoListItem>({
        render: (aluno: AlunoListItem) => (
          <Badge status={aluno.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />
        ),
      });
      return {
        ...col,
        width: 'w-[4.5rem] max-lg:shrink-0 max-lg:whitespace-nowrap lg:w-[12%]',
        cellClassName: cn(col.cellClassName, 'align-middle'),
      };
    })(),
    (() => {
      const col = actionsColumn<AlunoListItem>({
        onEdit,
        onDelete: (aluno) => {
          if (aluno.status === 'INATIVO') {
            onReactivate(aluno);
            return;
          }
          onDelete(aluno);
        },
        editButtonAriaLabel: (aluno: AlunoListItem) => `Editar aluno ${aluno.nome ?? ''}`,
        deleteLabel: (aluno: AlunoListItem) => (aluno.status === 'INATIVO' ? 'Reativar' : 'Excluir'),
        deleteIcon: (aluno: AlunoListItem) =>
          aluno.status === 'INATIVO' ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          ),
        deleteButtonAriaLabel: (aluno: AlunoListItem) =>
          `${aluno.status === 'INATIVO' ? 'Reativar' : 'Excluir'} aluno ${aluno.nome ?? ''}`,
        editDisabled: !canWrite,
        deleteDisabled: !canWrite,
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
      data={alunos}
      rowKey={(a) => a.id}
      loading={loading}
      skeletonRows={5}
      onRowClick={onOpenDetail}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500">Nenhum aluno encontrado</div>
      }
      ariaLabel="Tabela de alunos"
    />
  );
}

// (Pagination local removida; usando componente compartilhado.)

async function fetchAlunoDetails(alunoId: string): Promise<EditAluno> {
  const res = await fetch(`/api/alunos/${alunoId}`);
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('Seu perfil não tem permissão para acessar os dados completos deste aluno.');
    }
    if (res.status === 404) {
      throw new Error('Aluno não encontrado. Atualize a lista e tente novamente.');
    }
    throw new Error('Tente novamente.');
  }
  const data = (await res.json()) as Partial<EditAluno>;
  return {
    id: data.id || alunoId,
    nome: data.nome || '',
    nomeSocial: data.nomeSocial ?? null,
    dataNasc: (data.dataNasc as string | null) ?? null,
    cpf: data.cpf ?? null,
    email: data.email ?? null,
    telefone: data.telefone ?? null,
    foto: data.foto ?? null,
    enderecoCep: data.enderecoCep ?? null,
    enderecoLogradouro: data.enderecoLogradouro ?? null,
    enderecoNumero: data.enderecoNumero ?? null,
    enderecoComplemento: data.enderecoComplemento ?? null,
    enderecoBairro: data.enderecoBairro ?? null,
    enderecoCidade: data.enderecoCidade ?? null,
    enderecoUf: data.enderecoUf ?? null,
    observacao: data.observacao ?? null,
    genero: data.genero ?? null,
    modalidadePrincipal: data.modalidadePrincipal ?? null,
    nivel: data.nivel ?? null,
    alergias: data.alergias ?? null,
    restricoesMedicas: data.restricoesMedicas ?? null,
    contatoEmergenciaNome: data.contatoEmergenciaNome ?? null,
    contatoEmergenciaTelefone: data.contatoEmergenciaTelefone ?? null,
    origemCadastro: data.origemCadastro ?? null,
    bolsaDescontoPercent: data.bolsaDescontoPercent ?? null,
    isentoTaxaMatricula: data.isentoTaxaMatricula ?? null,
    consentimentoImagem: data.consentimentoImagem ?? null,
    dataConsentimentoImagem: data.dataConsentimentoImagem ?? null,
    consentimentoComunicacoes: data.consentimentoComunicacoes ?? null,
    tamanhoCamiseta: data.tamanhoCamiseta ?? null,
    tamanhoCalcado: data.tamanhoCalcado ?? null,
    codigoInterno: data.codigoInterno ?? null,
    asaasCustomerId: data.asaasCustomerId ?? null,
    tags: Array.isArray(data.tags) ? data.tags : null,
    status: data.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    responsavel: data.responsavel ?? null,
  } as EditAluno;
}

export default AlunosFeature;
