'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import EntityFiltersBar, {
  type SortOrder as SortOrderEF,
} from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import TableLayout from '@/components/layout/TableLayout';
import { Eye, Plus } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import useCurrentUser from '@/hooks/use-current-user';
import { useEntityListFiltering } from '@/hooks/entity/use-entity-list-filtering';
import { formatInitials, maskCpf, maskPhone } from '@alusa/lib/client';
import { actionsColumn } from '@alusa/ui/datatable/columns';

import { useResponsaveis } from './hooks/use-responsaveis';
import { createResponsavel, type ResponsavelListItem } from './services/responsaveis-service';

const PAGE_SIZE = 6;

type SortOrder = 'ASC' | 'DESC';

type ResponsavelFormState = {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  financeiro: boolean;
};

const initialFormState: ResponsavelFormState = {
  nome: '',
  cpf: '',
  email: '',
  telefone: '',
  financeiro: true,
};

export function ResponsaveisFeature() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const { items, loading, reload } = useResponsaveis({ enabled: Boolean(user?.contaId) });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResponsavelFormState>(initialFormState);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const {
    search,
    setSearch,
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
    nameAccessor: (responsavel) => responsavel.nome ?? '',
    searchPredicate: (responsavel, term, digits) => {
      const cpfDigits = (responsavel.cpf ?? '').replace(/\D/g, '');
      const telefoneDigits = (responsavel.telefone ?? '').replace(/\D/g, '');
      return (
        (responsavel.nome ?? '').toLowerCase().includes(term) ||
        (responsavel.email ?? '').toLowerCase().includes(term) ||
        Boolean(digits && (cpfDigits.includes(digits) || telefoneDigits.includes(digits)))
      );
    },
    statusFilterEnabled: false,
    initialSort: 'ASC',
  });

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [setPageSize]);

  useEffect(() => {
    setSort(sortOrder);
  }, [sortOrder, setSort]);

  useEffect(() => {
    setSortOrder(sort);
  }, [sort]);

  async function handleCreate() {
    setCreating(true);
    try {
      const responsavel = await createResponsavel(form);
      pushToast({
        title: 'Responsável cadastrado',
        description: 'O cadastro já está disponível para vínculos familiares.',
        variant: 'success',
      });
      setDialogOpen(false);
      setForm(initialFormState);
      resetFilters();
      await reload();
      router.push(`/responsaveis/${responsavel.id}`);
    } catch (error) {
      pushToast({
        title: 'Não foi possível cadastrar',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <TableLayout
      title="Gestão de Responsáveis"
      subtitle="Centralize responsáveis financeiros, contatos familiares e vínculos com alunos."
      actions={
        <>
          <Button
            onClick={() => setDialogOpen(true)}
            className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
            disabled={!user?.contaId}
          >
            <Plus className="h-4 w-4 mr-2 transition-none" />
            Novo responsável
          </Button>
        </>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={search}
          onSearchChange={setSearch}
          statusValue="TODOS"
          onStatusChange={() => undefined}
          sortOrder={sortOrder as SortOrderEF}
          onSortChange={(value) => setSortOrder(value as SortOrder)}
          searchPlaceholder="Buscar por nome, CPF, e-mail ou telefone..."
          hideStatusFilter
        />
      }
      footer={
        <Pagination total={ordered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
      }
    >
      <div className="bg-white rounded-xl border overflow-hidden">
        <ResponsaveisTable
          responsaveis={paginated}
          loading={loading || userLoading}
          onOpenDetail={(responsavel) => router.push(`/responsaveis/${responsavel.id}`)}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo responsável</DialogTitle>
            <DialogDescription>
              Cadastre a pessoa que poderá concentrar vínculos familiares, cobranças e acesso ao
              portal.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                className="mb-1.5 block text-xs font-medium text-slate-600"
                htmlFor="responsavel-nome"
              >
                Nome completo
              </label>
              <Input
                id="responsavel-nome"
                value={form.nome}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nome: event.target.value }))
                }
                placeholder="Ex.: Elaine Costa"
                className="h-10 rounded-lg border-slate-200 shadow-none"
              />
            </div>
            <div>
              <label
                className="mb-1.5 block text-xs font-medium text-slate-600"
                htmlFor="responsavel-cpf"
              >
                CPF
              </label>
              <Input
                id="responsavel-cpf"
                value={form.cpf}
                onChange={(event) =>
                  setForm((current) => ({ ...current, cpf: event.target.value }))
                }
                placeholder="000.000.000-00"
                className="h-10 rounded-lg border-slate-200 shadow-none"
              />
            </div>
            <div>
              <label
                className="mb-1.5 block text-xs font-medium text-slate-600"
                htmlFor="responsavel-telefone"
              >
                Telefone
              </label>
              <Input
                id="responsavel-telefone"
                value={form.telefone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, telefone: event.target.value }))
                }
                placeholder="(11) 99999-9999"
                className="h-10 rounded-lg border-slate-200 shadow-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                className="mb-1.5 block text-xs font-medium text-slate-600"
                htmlFor="responsavel-email"
              >
                E-mail
              </label>
              <Input
                id="responsavel-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="responsavel@email.com"
                className="h-10 rounded-lg border-slate-200 shadow-none"
              />
            </div>
            <label className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-accent"
                checked={form.financeiro}
                onChange={(event) =>
                  setForm((current) => ({ ...current, financeiro: event.target.checked }))
                }
              />
              <span>
                <span className="block font-medium text-slate-800">
                  Marcar como responsável financeiro
                </span>
                <span className="block text-xs text-slate-500">
                  Este será o padrão para cobranças familiares e futuras rematrículas.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="h-10 rounded-lg border-slate-200 shadow-none"
              onClick={() => setDialogOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Salvando...' : 'Salvar responsável'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableLayout>
  );
}

function ResponsaveisTable({
  responsaveis,
  loading,
  onOpenDetail,
}: {
  responsaveis: ResponsavelListItem[];
  loading: boolean;
  onOpenDetail: (_responsavel: ResponsavelListItem) => void;
}) {
  const columns: DataTableColumn<ResponsavelListItem>[] = [
    {
      id: 'responsavel',
      header: 'Responsável',
      width: 'w-[44%]',
      align: 'left',
      noWrap: false,
      skeleton: (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="h-4 w-40 bg-gray-200 rounded" />
        </div>
      ),
      render: (responsavel) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-violet-100 text-violet-700 font-medium">
              {formatInitials(responsavel.nome ?? '')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 truncate font-normal text-gray-900 text-[13px]">{responsavel.nome}</div>
        </div>
      ),
    },
    {
      id: 'vinculos',
      header: 'Alunos',
      width: 'w-[7%]',
      align: 'center',
      render: (responsavel) => {
        const count = responsavel.alunosCount ?? 0;
        if (count === 0) {
          return <span className="text-xs text-slate-400">—</span>;
        }
        return (
          <Badge variant="neutral" className="text-[10px] font-normal capitalize tracking-normal">
            {count} aluno{count === 1 ? '' : 's'}
          </Badge>
        );
      },
      skeleton: <div className="h-6 w-14 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'cpf',
      header: 'CPF',
      width: 'w-[9%]',
      align: 'center',
      render: (responsavel) => (
        <span className="tabular-nums leading-[20px]">
          {responsavel.cpf ? maskCpf(responsavel.cpf) : '-'}
        </span>
      ),
      skeleton: <div className="h-4 w-24 bg-gray-200 rounded mx-auto" />,
    },
    {
      id: 'email',
      header: 'E-mail',
      width: 'w-[16%]',
      align: 'left',
      headerClassName: 'pl-6 pr-2',
      cellClassName: 'overflow-hidden pl-6 pr-2',
      render: (responsavel) => (
        <span
          className="block w-full truncate text-[13px] leading-5 text-gray-900"
          title={responsavel.email ?? undefined}
        >
          {responsavel.email?.trim() || '—'}
        </span>
      ),
      skeleton: <div className="h-4 w-36 max-w-full bg-gray-200 rounded" />,
    },
    {
      id: 'telefone',
      header: 'Telefone',
      width: 'w-[16%]',
      align: 'left',
      headerClassName: 'pl-2 pr-6',
      cellClassName: 'overflow-hidden pl-2 pr-6',
      render: (responsavel) => (
        <span className="block w-full truncate text-[13px] tabular-nums leading-5 text-gray-900">
          {maskPhone(responsavel.telefone) || '—'}
        </span>
      ),
      skeleton: <div className="h-4 w-28 bg-gray-200 rounded" />,
    },
    {
      ...actionsColumn<ResponsavelListItem>({
        onEdit: onOpenDetail,
        editLabel: 'Ver detalhes',
        editButtonAriaLabel: (responsavel) => `Ver responsável ${responsavel.nome}`,
        editIcon: <Eye className="h-4 w-4" />,
        skeleton: (
          <div className="flex justify-center">
            <div className="h-8 w-8 bg-gray-200 rounded" />
          </div>
        ),
      }),
      width: 'w-[8%]',
      headerClassName: undefined,
      cellClassName: undefined,
    },
  ];

  return (
    <DataTable
      tableClassName="table-fixed"
      columns={columns}
      data={responsaveis}
      rowKey={(responsavel) => responsavel.id}
      loading={loading}
      skeletonRows={5}
      onRowClick={onOpenDetail}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500">Nenhum responsável encontrado</div>
      }
      ariaLabel="Tabela de responsáveis"
    />
  );
}
