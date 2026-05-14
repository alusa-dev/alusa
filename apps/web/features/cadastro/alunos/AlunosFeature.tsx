'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
// (Busca agora controlada pelo EntityFiltersBar; Input removido)
// Removido select custom inline (usaremos EntityFiltersBar)
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
// Skeleton manual substituído pelos skeletons do DataTable
import { Plus } from '@/components/icons/icons';
// Dropdown de ordenação substituído pelo EntityFiltersBar
import AlunoWizardDialog from '@/components/alunos/AlunoWizardDialog';
import { AlunoEditDialog, type EditAluno } from '@/components/alunos/AlunoEditDialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import ReasonField from '@/components/shared/ReasonField';
import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import EntityFiltersBar, {
  type StatusValue,
  type SortOrder as SortOrderEF,
} from '@/components/layout/EntityFiltersBar';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { formatFirstLast, formatInitials, maskCpf, maskPhone } from '@alusa/lib/client';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import { useEditDialog } from '@/hooks/use-edit-dialog';
import useCurrentUser from '@/hooks/use-current-user';
import { useAlunos } from './hooks/use-alunos';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import type { AlunoListItem } from './services/alunos-service';
import { pushToast } from '@/components/ui/toast';
import { statusColumn, actionsColumn } from '@alusa/ui/datatable/columns';

const PAGE_SIZE = 6;

type SortOrder = 'ASC' | 'DESC';
type StatusFilter = StatusValue;

interface AlunosTableProps {
  alunos: AlunoListItem[];
  onEdit: (_aluno: AlunoListItem) => void;
  onDelete: (_aluno: AlunoListItem) => void;
  onOpenDetail: (_aluno: AlunoListItem) => void;
  loading: boolean;
}

// Paginação unificada via componente compartilhado

export function AlunosFeature() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const { items, loading, reload, remove } = useAlunos({ contaId });
  const editDialog = useEditDialog<EditAluno>();
  const deleteDialog = useDeleteDialog<AlunoListItem>({
    onDelete: async (aluno, reason) => {
      try {
        await remove({ id: aluno.id, reason });
        pushToast({
          title: 'Aluno excluído',
          variant: 'success',
        });
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch (error) {
        pushToast({
          title: 'Não foi possível excluir',
          description: (error as Error).message || 'Erro ao excluir aluno',
          variant: 'error',
        });
      }
    },
  });

  const refresh = useCallback(() => {
    void reload();
  }, [reload]);

  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC'); // manter para interface com EntityFiltersBar
  // Hook reutilizável para filtragem, busca, status, paginação e ordenação
  const {
    search: searchTerm,
    setSearch: setSearchTerm,
    status: statusFilter,
    setStatus: setStatusFilter,
    sort,
    setSort,
    page,
    setPage,
    setPageSize,
    ordered,
    paginated,
    resetFilters,
  } = useEntityListFiltering({
    items,
    nameAccessor: (a: AlunoListItem) => a.nome ?? '',
    statusAccessor: (a: AlunoListItem) => (a.status as StatusFilter) ?? 'ATIVO',
    searchPredicate: (a: AlunoListItem, term, digits) => {
      const nome = (a.nome || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      const cpfDigits = (a.cpf || '').replace(/\D/g, '');
      const matchNome = nome.includes(term);
      const matchEmail = email.includes(term);
      const matchCpf = Boolean(digits && cpfDigits.includes(digits));
      return matchNome || matchEmail || matchCpf;
    },
    initialSort: 'ASC',
  });
  const [wizardOpen, setWizardOpen] = useState(false);

  // Definir PAGE_SIZE no hook
  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [setPageSize]);

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

  const handleOpenWizard = useCallback(async () => {
    if (!contaId) return;
    setWizardOpen(true);
  }, [contaId]);

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
            disabled={!contaId}
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
      footer={
        <Pagination total={ordered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
      }
    >
      <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
        <AlunosTable
          alunos={paginated}
          onEdit={(aluno) => {
            editDialog.openDialog(mapToEditAluno(aluno));
            void loadAlunoDetails(aluno.id, editDialog.setEntity);
          }}
          onDelete={(aluno) => {
            deleteDialog.openDialog(aluno);
          }}
          onOpenDetail={(aluno) => router.push(`/alunos/${aluno.id}`)}
          loading={loading || userLoading}
        />
      </div>

      {/* Paginação removida daqui e movida para footer do TableLayout */}
      <AlunoWizardDialog
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

      <AlunoEditDialog
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

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        title="Excluir aluno"
        description={(() => {
          if (!deleteDialog.entity) {
            return 'Tem certeza que deseja excluir este aluno? Esta ação é permanente.';
          }
          const rawName = deleteDialog.entity.nome ?? '';
          const shortName = formatFirstLast(rawName) || rawName || 'este aluno';
          return (
            <span>
              Tem certeza que deseja excluir <strong>{shortName}</strong>? Esta ação é permanente.
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
            pushToast({
              title: 'Aluno excluído',
              variant: 'success',
            });
            await reload();
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
      </ConfirmDeleteDialog>
    </TableLayout>
  );
}

function AlunosTable({
  alunos,
  onEdit,
  onDelete,
  onOpenDetail,
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
        const initials = formatInitials(aluno.nome ?? '');
        return (
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Avatar className="h-9 w-9 shrink-0 lg:h-10 lg:w-10">
              {aluno.foto ? <AvatarImage src={aluno.foto} alt={aluno.nome ?? ''} /> : null}
              <AvatarFallback className="bg-purple-100 font-medium text-purple-700">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[13px] font-normal text-gray-900"
                data-testid={`aluno-nome-${aluno.id}`}
              >
                {aluno.nome}
              </div>
              <div className="mt-0.5 text-[12px] tabular-nums leading-snug text-gray-500 lg:hidden">
                {aluno.cpf ? maskCpf(aluno.cpf) : '—'}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {aluno.isentoTaxaMatricula && (
                  <Badge variant="info" className="text-[10px] font-bold tracking-widest uppercase">
                    Isento
                  </Badge>
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
          {aluno.cpf ? maskCpf(aluno.cpf) : '-'}
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
          {aluno.email || '-'}
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
        <span className="tabular-nums leading-[20px]">{maskPhone(aluno.telefone) || '-'}</span>
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
        onDelete,
        editButtonAriaLabel: (aluno: AlunoListItem) => `Editar aluno ${aluno.nome ?? ''}`,
        deleteButtonAriaLabel: (aluno: AlunoListItem) => `Excluir aluno ${aluno.nome ?? ''}`,
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

function mapToEditAluno(aluno: AlunoListItem): EditAluno {
  const bolsa = aluno.bolsaDescontoPercent;
  const bolsaNumber = typeof bolsa === 'number' ? bolsa : null;

  return {
    id: aluno.id,
    nome: aluno.nome,
    nomeSocial: null,
    dataNasc: null,
    cpf: aluno.cpf ?? null,
    email: aluno.email ?? null,
    telefone: aluno.telefone ?? null,
    foto: aluno.foto ?? null,
    enderecoCep: null,
    enderecoLogradouro: null,
    enderecoNumero: null,
    enderecoComplemento: null,
    enderecoBairro: null,
    enderecoCidade: null,
    enderecoUf: null,
    observacao: null,
    genero: null,
    modalidadePrincipal: null,
    nivel: null,
    alergias: null,
    restricoesMedicas: null,
    contatoEmergenciaNome: null,
    contatoEmergenciaTelefone: null,
    origemCadastro: null,
    bolsaDescontoPercent: bolsaNumber,
    isentoTaxaMatricula: aluno.isentoTaxaMatricula ?? null,
    consentimentoImagem: aluno.consentimentoImagem ?? null,
    dataConsentimentoImagem: aluno.dataConsentimentoImagem ?? null,
    consentimentoComunicacoes: null,
    tamanhoCamiseta: null,
    tamanhoCalcado: null,
    codigoInterno: null,
    tags: Array.isArray(aluno.tags) ? aluno.tags : null,
    status: aluno.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    responsavel: null,
  } as EditAluno;
}

async function fetchAlunoDetails(alunoId: string): Promise<EditAluno | null> {
  const res = await fetch(`/api/alunos/${alunoId}`);
  if (!res.ok) return null;
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

async function loadAlunoDetails(
  alunoId: string,
  setEntity: (_value: EditAluno | null) => void,
) {
  const aluno = await fetchAlunoDetails(alunoId);
  if (aluno) {
    setEntity(aluno);
  }
}

export default AlunosFeature;
