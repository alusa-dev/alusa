'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Command as CommandPrimitive } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { ArrowLeft, Plus, Search, UserRound, UsersRound } from 'lucide-react';

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RematriculaDialog } from '@/components/matriculas/RematriculaDialog';
import { RematriculaFamiliarDialog } from '@/components/matriculas/RematriculaFamiliarDialog';
import useCurrentUser from '@/hooks/use-current-user';
import { useRematriculas } from '@/features/cadastro/rematriculas/hooks/use-rematriculas';
import type {
  RematriculaElegivelItem,
  RematriculaProcessSummary,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';

type RematriculaTitularGroup = {
  id: string;
  tipo: 'RESPONSAVEL' | 'ALUNO';
  titular: {
    id: string;
    nome: string;
    cpf?: string | null;
    foto?: string | null;
  };
  itens: RematriculaElegivelItem[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getProcessLabel(status: RematriculaProcessSummary['status']) {
  const labels: Record<RematriculaProcessSummary['status'], string> = {
    DRAFT: 'Rascunho',
    PREVIEWED: 'Preview',
    PARTIALLY_CONFIRMED: 'Parcial',
    CONFIRMED: 'Confirmada',
    WAITING_FOR_START: 'Aguardando início',
    REQUIRES_ATTENTION: 'Requer atenção',
    EFFECTIVE: 'Novo ciclo iniciado',
    CANCELLED: 'Cancelada',
    COMPLETED: 'Encerrada',
  };
  return labels[status] ?? status;
}

function getProcessBadgeVariant(status: RematriculaProcessSummary['status']): BadgeVariant {
  if (status === 'REQUIRES_ATTENTION') return 'warning';
  if (status === 'CANCELLED') return 'destructive';
  if (status === 'EFFECTIVE' || status === 'COMPLETED') return 'default';
  return 'info';
}

function buildTitularGroups(items: RematriculaElegivelItem[]): RematriculaTitularGroup[] {
  const groups = new Map<string, RematriculaTitularGroup>();

  for (const item of items) {
    const responsavel = item.responsavelFinanceiro;
    const tipo = responsavel ? 'RESPONSAVEL' : 'ALUNO';
    const titular = responsavel
      ? {
          id: responsavel.id,
          nome: responsavel.nome ?? 'Responsável sem nome',
          cpf: responsavel.cpf,
          foto: responsavel.foto,
        }
      : {
          id: item.aluno.id,
          nome: item.aluno.nome ?? 'Aluno sem nome',
          cpf: item.aluno.cpf,
          foto: item.aluno.foto,
        };
    const key = `${tipo}:${titular.id}`;
    const current = groups.get(key);

    if (current) {
      current.itens.push(item);
    } else {
      groups.set(key, {
        id: key,
        tipo,
        titular,
        itens: [item],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.titular.nome.localeCompare(b.titular.nome, 'pt-BR'),
  );
}

export default function RematriculaCampanhaDetalhePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [processSearch, setProcessSearch] = useState('');
  const [processStatusFilter, setProcessStatusFilter] = useState<'TODOS' | RematriculaProcessSummary['status']>('TODOS');
  const [selectedSearchGroup, setSelectedSearchGroup] = useState<RematriculaTitularGroup | null>(null);
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [selectedTitular, setSelectedTitular] = useState<RematriculaTitularGroup | null>(null);

  const { items, loading, campaigns, processes, reload } = useRematriculas({
    contaId,
    diasAntecedencia: 365,
  });

  const campaign = useMemo(
    () => campaigns.find((item) => item.id === campaignId) ?? null,
    [campaignId, campaigns],
  );

  const eligibleItems = items;

  const titularGroups = useMemo(() => buildTitularGroups(eligibleItems), [eligibleItems]);

  const filteredGroups = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return titularGroups;

    return titularGroups.filter((group) => {
      const alunos = group.itens.map((item) => item.aluno.nome ?? '').join(' ');
      return `${group.titular.nome} ${group.titular.cpf ?? ''} ${alunos}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [search, titularGroups]);

  const suggestionGroups = useMemo(() => {
    if (!search.trim() || selectedSearchGroup) return [];
    return filteredGroups.slice(0, 6);
  }, [filteredGroups, search, selectedSearchGroup]);

  const campaignProcesses = useMemo(() => {
    const normalized = processSearch.trim().toLowerCase();
    return processes
      .filter((process) => process.campanhaId === campaignId)
      .filter((process) => {
        if (processStatusFilter !== 'TODOS' && process.status !== processStatusFilter) return false;
        if (!normalized) return true;
        const alunos = process.itens.map((item) => item.aluno?.nome ?? '').join(' ');
        const vinculos = process.itens
          .map((item) => item.turmaAtual?.nome ?? item.comboAtual?.nome ?? '')
          .join(' ');
        return `${alunos} ${vinculos} ${process.holderId}`.toLowerCase().includes(normalized);
      });
  }, [campaignId, processSearch, processStatusFilter, processes]);

  function resetSearchModal() {
    setSearch('');
    setSelectedSearchGroup(null);
  }

  function handleConfirmSearchSelection() {
    if (!selectedSearchGroup) return;
    setSearchOpen(false);
    if (selectedSearchGroup.tipo === 'RESPONSAVEL') {
      setSelectedTitular(selectedSearchGroup);
    } else {
      setSelectedMatricula(selectedSearchGroup.itens[0] ?? null);
    }
    resetSearchModal();
  }

  const columns: DataTableColumn<RematriculaProcessSummary>[] = [
    {
      id: 'titular',
      header: 'Aluno / responsável',
      width: 'min-w-0 lg:w-[28%]',
      align: 'left',
      noWrap: false,
      render: (process) => {
        const alunos = process.itens
          .map((item) => item.aluno?.nome)
          .filter(Boolean)
          .join(', ');
        return (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-900">
              {alunos || process.holderId}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {process.holderType === 'RESPONSIBLE' ? 'Responsável financeiro' : 'Aluno titular'}
            </div>
          </div>
        );
      },
    },
    {
      id: 'vinculo',
      header: 'Vínculo atual',
      width: 'lg:w-[18%]',
      align: 'left',
      render: (process) => (
        <span className="text-[13px] text-slate-700">
          {process.itens[0]?.turmaAtual?.nome ??
            process.itens[0]?.comboAtual?.nome ??
            'Sem turma atual'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'lg:w-[14%]',
      align: 'center',
      render: (process) => (
        <Badge variant={getProcessBadgeVariant(process.status)}>
          {getProcessLabel(process.status)}
        </Badge>
      ),
    },
    {
      id: 'reserva',
      header: 'Reserva',
      width: 'lg:w-[12%]',
      align: 'center',
      render: (process) => (
        <span className="text-[13px] text-slate-700">
          {process.reservas[0]?.status ?? 'NOT_RESERVED'}
        </span>
      ),
    },
    {
      id: 'financeiro',
      header: 'Financeiro futuro',
      width: 'lg:w-[16%]',
      align: 'left',
      render: (process) => (
        <div className="min-w-0 text-[13px] text-slate-700">
          <div>{process.financeiros[0]?.status ?? 'NOT_PREPARED'}</div>
          <div className="text-xs text-slate-500">
            R$ {process.monthlyTotal.toFixed(2)}
          </div>
        </div>
      ),
    },
    {
      id: 'inicio',
      header: 'Início previsto',
      width: 'lg:w-[12%]',
      align: 'left',
      render: (process) => (
        <span className="text-[13px] text-slate-700">{formatDate(process.effectiveAt)}</span>
      ),
    },
  ];

  if (loading && !campaign) {
    return (
      <section className="w-full px-1 py-1 md:px-0 md:py-0">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
          Carregando campanha...
        </div>
      </section>
    );
  }

  if (!campaign) {
    return (
      <section className="w-full px-1 py-1 md:px-0 md:py-0">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10">
          <button
            type="button"
            className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
            onClick={() => router.push('/rematriculas')}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <h1 className="text-xl font-semibold text-slate-950">Campanha não encontrada</h1>
          <p className="mt-2 text-sm text-slate-500">
            A campanha pode ter sido removida ou não pertence à conta atual.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="w-full px-1 py-1 md:px-0 md:py-0">
        <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
              onClick={() => router.push('/rematriculas')}
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <div className="min-w-0 space-y-1">
              <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 md:text-[24px]">
                Detalhes da Campanha
              </h1>
              <p className="max-w-3xl text-[13px] text-gray-500">
                Organize adesões, reservas futuras e processos vinculados à campanha {campaign.nome}.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Button
                type="button"
                className="h-10 w-full rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 lg:w-auto"
                onClick={() => setSearchOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Rematricular
              </Button>

              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_180px] lg:w-[580px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={processSearch}
                    onChange={(event) => setProcessSearch(event.target.value)}
                    placeholder="Buscar por nome..."
                    className="h-10 rounded-lg border-slate-200 pl-10 shadow-none"
                  />
                </label>
                <Select
                  value={processStatusFilter}
                  onValueChange={(value) =>
                    setProcessStatusFilter(value as 'TODOS' | RematriculaProcessSummary['status'])
                  }
                >
                  <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="TODOS">Todos os status</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmada</SelectItem>
                    <SelectItem value="WAITING_FOR_START">Aguardando início</SelectItem>
                    <SelectItem value="REQUIRES_ATTENTION">Requer atenção</SelectItem>
                    <SelectItem value="EFFECTIVE">Novo ciclo iniciado</SelectItem>
                    <SelectItem value="CANCELLED">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <DataTable
              columns={columns}
              data={campaignProcesses}
              rowKey={(process) => process.id}
              loading={loading}
              skeletonRows={4}
              emptyMessage={
                <div className="px-6 py-14 text-center">
                  <p className="text-sm font-medium text-slate-400">
                    Nenhuma rematrícula iniciada nesta campanha.
                  </p>
                </div>
              }
              ariaLabel="Tabela de rematrículas da campanha"
            />
          </div>
        </div>
      </section>

      <Dialog
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) resetSearchModal();
        }}
      >
        <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0">
          <div className="border-b border-slate-100 px-6 py-5">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Rematricular
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              Busque alunos ou responsáveis com matrícula ativa e selecione o vínculo para preparar o próximo ciclo.
            </DialogDescription>
          </div>

          <div className="space-y-3 px-6 py-5">
            <Popover.Root open={Boolean(search.trim()) && !selectedSearchGroup}>
              <Popover.Anchor asChild>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSelectedSearchGroup(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setSearch('');
                        setSelectedSearchGroup(null);
                      }
                    }}
                    placeholder="Buscar aluno ou responsável"
                    className="h-10 rounded-lg border-slate-200 pl-10 shadow-none focus:border-[#5c2f91] focus:ring-2 focus:ring-[#5c2f91]/30"
                    aria-autocomplete="list"
                    aria-expanded={Boolean(search.trim()) && !selectedSearchGroup}
                    aria-controls="rematricula-campaign-suggestions"
                  />
                </div>
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content
                  className="z-[99999] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                  sideOffset={4}
                  align="start"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <CommandPrimitive
                    shouldFilter={false}
                    className="max-h-[calc(4*58px+8px)] overflow-y-auto"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#d1d5db transparent',
                    }}
                  >
                    <CommandPrimitive.List id="rematricula-campaign-suggestions">
                      {suggestionGroups.length === 0 ? (
                        <CommandPrimitive.Empty className="select-none px-4 py-3 text-sm text-gray-500">
                          Nenhum aluno ou responsável encontrado
                        </CommandPrimitive.Empty>
                      ) : null}
                      {suggestionGroups.map((group, index) => {
                        const alunos = group.itens
                          .map((item) => item.aluno.nome)
                          .filter(Boolean)
                          .join(', ');
                        return (
                          <CommandPrimitive.Item
                            key={group.id}
                            value={group.id}
                            onSelect={() => {
                              setSelectedSearchGroup(group);
                              setSearch(group.titular.nome);
                            }}
                            className={cn(
                              'w-full cursor-pointer px-3 py-2.5 text-left text-sm text-gray-900 bg-white',
                              'hover:bg-gray-50 data-[selected=true]:bg-gray-100 data-[selected=true]:text-gray-900',
                              'aria-selected:bg-gray-100 aria-selected:text-gray-900 focus:bg-gray-100 focus:outline-none',
                              '[&[data-highlighted]]:bg-gray-100 [&[data-highlighted]]:text-gray-900',
                              index < suggestionGroups.length - 1 && 'border-b border-gray-100',
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-gray-900">
                                  {group.titular.nome}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-gray-500">
                                  {alunos || (group.tipo === 'RESPONSAVEL' ? 'Responsável' : 'Aluno')}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 text-slate-500">
                                {group.tipo === 'RESPONSAVEL' ? (
                                  <UsersRound className="h-4 w-4" />
                                ) : (
                                  <UserRound className="h-4 w-4" />
                                )}
                                <span className="text-xs font-medium">{group.itens.length}</span>
                              </div>
                            </div>
                          </CommandPrimitive.Item>
                        );
                      })}
                    </CommandPrimitive.List>
                  </CommandPrimitive>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            {selectedSearchGroup ? (
              <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {selectedSearchGroup.titular.foto ? (
                        <AvatarImage
                          src={selectedSearchGroup.titular.foto}
                          alt={selectedSearchGroup.titular.nome}
                        />
                      ) : null}
                      <AvatarFallback className="bg-purple-100 text-purple-700">
                        {getInitials(selectedSearchGroup.titular.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {selectedSearchGroup.titular.nome}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {selectedSearchGroup.itens
                          .map((item) => item.aluno.nome)
                          .filter(Boolean)
                          .join(', ') || (selectedSearchGroup.tipo === 'RESPONSAVEL' ? 'Responsável' : 'Aluno')}
                      </div>
                    </div>
                  </div>
                  <Badge variant="info">
                    {selectedSearchGroup.itens.length} vínculo(s)
                  </Badge>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[104px] rounded-lg border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50"
              onClick={() => {
                setSearchOpen(false);
                resetSearchModal();
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-10 min-w-[124px] rounded-lg bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
              disabled={!selectedSearchGroup}
              onClick={handleConfirmSearchSelection}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <RematriculaDialog
        open={Boolean(selectedMatricula)}
        contaId={contaId ?? undefined}
        campaignId={campaign.id}
        targetPeriodId={campaign.targetPeriodId}
        item={selectedMatricula}
        onOpenChange={(open) => {
          if (!open) setSelectedMatricula(null);
        }}
        onCreated={() => {
          setSelectedMatricula(null);
          void reload();
        }}
      />

      <RematriculaFamiliarDialog
        open={Boolean(selectedTitular)}
        contaId={contaId ?? undefined}
        campaignId={campaign.id}
        targetPeriodId={campaign.targetPeriodId}
        titular={selectedTitular?.titular ? {
          id: selectedTitular.titular.id,
          tipo: selectedTitular.tipo,
          nome: selectedTitular.titular.nome,
          cpf: selectedTitular.titular.cpf,
          foto: selectedTitular.titular.foto,
        } : null}
        itens={selectedTitular?.itens ?? []}
        onOpenChange={(open) => {
          if (!open) setSelectedTitular(null);
        }}
        onCreated={() => {
          setSelectedTitular(null);
          void reload();
        }}
      />
    </>
  );
}
