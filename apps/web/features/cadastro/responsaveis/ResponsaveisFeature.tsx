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
import { cn } from '@/lib/utils';
import { table } from '@/components/layout/TableStyles';

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResponsavelFormState>(initialFormState);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');
  const [serverQuery, setServerQuery] = useState('');
  const { items, loading, reload } = useResponsaveis({
    enabled: Boolean(user?.contaId),
    query: serverQuery,
  });

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
      if (digits && digits.length >= 3) return true;
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
    setServerQuery(search);
  }, [search]);

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
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
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
    >
      <div className={table.container}>
        <ResponsaveisTable
          responsaveis={paginated}
          loading={loading || userLoading}
          onOpenDetail={(responsavel) => router.push(`/responsaveis/${responsavel.id}`)}
        />
        {ordered.length > PAGE_SIZE ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={ordered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          fullScreenMobile
          className="max-w-2xl w-full gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0"
        >
          <div className="relative border-b border-slate-200 bg-slate-50 p-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:p-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
              Novo responsável
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-sm text-slate-600">
              Cadastre a pessoa que poderá concentrar vínculos familiares, cobranças e acesso ao
              portal.
            </DialogDescription>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:max-h-none">
            <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth bg-slate-50 p-4 max-md:min-h-0 md:p-6">
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
                    className="h-11 rounded-lg border-slate-200 shadow-none md:h-10"
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
                    className="h-11 rounded-lg border-slate-200 shadow-none md:h-10"
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
                    className="h-11 rounded-lg border-slate-200 shadow-none md:h-10"
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
                    className="h-11 rounded-lg border-slate-200 shadow-none md:h-10"
                  />
                </div>
                <label className="sm:col-span-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm md:min-h-0 md:p-3 md:shadow-none">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-accent md:mt-1"
                    checked={form.financeiro}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, financeiro: event.target.checked }))
                    }
                  />
                  <span>
                    <span className="block font-medium text-slate-800">
                      Marcar como responsável financeiro
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Este será o padrão para cobranças familiares e futuras rematrículas.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-end md:gap-3 md:p-6">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full rounded-lg border-slate-200 shadow-none md:h-10 md:min-h-0 md:w-auto"
                onClick={() => setDialogOpen(false)}
                disabled={creating}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="h-11 min-h-11 w-full rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? 'Salvando...' : 'Salvar responsável'}
              </Button>
            </div>
          </div>
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
      width: 'min-w-0 lg:w-[32%]',
      align: 'left',
      noWrap: false,
      skeleton: (
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-gray-200 lg:h-10 lg:w-10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-28 rounded bg-gray-200 lg:hidden" />
          </div>
        </div>
      ),
      render: (responsavel) => (
        <div className="flex min-w-0 items-center gap-2 lg:gap-3">
          <Avatar className="h-9 w-9 shrink-0 lg:h-10 lg:w-10">
            <AvatarFallback className="bg-violet-100 font-medium text-violet-700">
              {formatInitials(responsavel.nome ?? '')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-normal text-gray-900">
              {responsavel.nome}
            </div>
            <div className="mt-0.5 text-[12px] tabular-nums leading-snug text-gray-500 lg:hidden">
              {responsavel.cpfMasked ?? (responsavel.cpf ? maskCpf(responsavel.cpf) : '—')}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'vinculos',
      header: 'Alunos',
      width: 'lg:w-[10%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
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
      skeleton: <div className="mx-auto hidden h-6 w-14 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'cpf',
      header: 'CPF',
      width: 'lg:w-[14%]',
      align: 'center',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell overflow-hidden',
      render: (responsavel) => (
        <span
          className="block w-full truncate tabular-nums leading-5 text-gray-900"
          title={responsavel.cpfMasked ?? (responsavel.cpf ? maskCpf(responsavel.cpf) : undefined)}
        >
          {responsavel.cpfMasked ?? (responsavel.cpf ? maskCpf(responsavel.cpf) : '-')}
        </span>
      ),
      skeleton: <div className="mx-auto hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'email',
      header: 'E-mail',
      width: 'lg:w-[22%]',
      align: 'left',
      headerClassName: 'hidden lg:table-cell pl-6 pr-2',
      cellClassName: 'hidden lg:table-cell overflow-hidden pl-6 pr-2',
      render: (responsavel) => (
        <span
          className="block w-full truncate text-[13px] leading-5 text-gray-900"
          title={responsavel.emailMasked ?? responsavel.email ?? undefined}
        >
          {responsavel.emailMasked ?? (responsavel.email?.trim() || '—')}
        </span>
      ),
      skeleton: <div className="hidden h-4 max-w-full w-36 rounded bg-gray-200 lg:block" />,
    },
    {
      id: 'telefone',
      header: 'Telefone',
      width: 'lg:w-[14%]',
      align: 'left',
      headerClassName: 'hidden lg:table-cell pl-2 pr-6',
      cellClassName: 'hidden lg:table-cell overflow-hidden pl-2 pr-6',
      render: (responsavel) => (
        <span
          className="block w-full truncate text-[13px] tabular-nums leading-5 text-gray-900"
          title={responsavel.phoneMasked ?? (maskPhone(responsavel.telefone) || undefined)}
        >
          {responsavel.phoneMasked ?? (maskPhone(responsavel.telefone) || '—')}
        </span>
      ),
      skeleton: <div className="hidden h-4 w-28 rounded bg-gray-200 lg:block" />,
    },
    (() => {
      const col = actionsColumn<ResponsavelListItem>({
        onEdit: onOpenDetail,
        editLabel: 'Ver detalhes',
        editButtonAriaLabel: (responsavel) => `Ver responsável ${responsavel.nome}`,
        editIcon: <Eye className="h-4 w-4" />,
        skeleton: (
          <div className="flex justify-center">
            <div className="h-8 w-8 rounded bg-gray-200" />
          </div>
        ),
      });
      return {
        ...col,
        width: 'w-[3.25rem] max-lg:shrink-0 lg:w-[8%]',
        headerClassName: cn(col.headerClassName, 'max-lg:px-1'),
        cellClassName: cn(col.cellClassName, 'max-lg:px-1'),
      };
    })(),
  ];

  return (
    <DataTable
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
