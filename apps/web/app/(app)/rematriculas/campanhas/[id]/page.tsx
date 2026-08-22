'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Command as CommandPrimitive } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, ArrowLeft, MoreVertical, Plus, Search, UserRound, UsersRound } from 'lucide-react';

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
} from '@/components/ui/select';
import { RematriculaDialog } from '@/components/matriculas/RematriculaDialog';
import { RematriculaFamiliarDialog } from '@/components/matriculas/RematriculaFamiliarDialog';
import {
  RematriculaProcessCancelDialog,
  RematriculaProcessDetailsDialog,
} from '@/features/cadastro/rematriculas/components/RematriculaProcessDialogs';
import { toast, CustomToast } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useCurrentUser from '@/hooks/use-current-user';
import { useRematriculas } from '@/features/cadastro/rematriculas/hooks/use-rematriculas';
import { useRematriculaCampaignOverview } from '@/features/cadastro/rematriculas/hooks/use-rematricula-campaign-overview';
import type {
  RematriculaCampaignClassOverview,
  RematriculaElegivelItem,
  RematriculaProcessSummary,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';
import { cancelRematriculaProcessRequest } from '@/features/cadastro/rematriculas/services/rematriculas-service';

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

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getProcessStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Rascunho',
    PREVIEWED: 'Prévia',
    PARTIALLY_CONFIRMED: 'Parcialmente confirmada',
    CONFIRMED: 'Confirmada',
    WAITING_FOR_START: 'Aguardando início',
    REQUIRES_ATTENTION: 'Requer atenção',
    EFFECTIVE: 'Novo ciclo iniciado',
    CANCELLED: 'Cancelada',
    COMPLETED: 'Encerrada',
  };
  return labels[status] ?? status;
}

function getReservationStatusLabel(status: string | null) {
  if (!status) return null;
  const labels: Record<string, string> = {
    NOT_RESERVED: 'Sem reserva',
    RESERVED: 'Reservada',
    WAITLISTED: 'Lista de espera',
    EXPIRED: 'Expirada',
    CONVERTED: 'Convertida',
    FAILED: 'Falhou',
    RELEASED: 'Liberada',
    CANCELLED: 'Cancelada',
  };
  return labels[status] ?? status;
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
  const [classSort, setClassSort] = useState<'PADRAO' | 'TURMA_ASC' | 'REMATRICULADOS_DESC' | 'VAGAS_DESC'>('PADRAO');
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [selectedClass, setSelectedClass] = useState<RematriculaCampaignClassOverview | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<RematriculaProcessSummary | null>(null);
  const [editingProcess, setEditingProcess] = useState<RematriculaProcessSummary | null>(null);
  const [cancelProcess, setCancelProcess] = useState<RematriculaProcessSummary | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);
  const [selectedSearchGroup, setSelectedSearchGroup] = useState<RematriculaTitularGroup | null>(null);
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [selectedTitular, setSelectedTitular] = useState<RematriculaTitularGroup | null>(null);

  const { items, loading, campaigns, processes, reload } = useRematriculas({
    contaId,
    diasAntecedencia: 365,
  });
  const {
    data: campaignOverview,
    loading: overviewLoading,
    error: overviewError,
  } = useRematriculaCampaignOverview(campaignId, overviewRefreshKey);

  const campaign = useMemo(
    () => campaigns.find((item) => item.id === campaignId) ?? null,
    [campaignId, campaigns],
  );

  const activeRenewalSourceIds = useMemo(() => {
    return new Set(
      processes
        .filter((process) => {
          const sameCampaign = process.campanhaId === campaignId;
          const sameTargetPeriod = campaign?.targetPeriodId
            ? process.targetPeriodId === campaign.targetPeriodId
            : false;
          return (sameCampaign || sameTargetPeriod) && process.status !== 'CANCELLED';
        })
        .flatMap((process) => process.itens.map((item) => item.matriculaOrigemId)),
    );
  }, [campaign?.targetPeriodId, campaignId, processes]);

  const eligibleItems = useMemo(
    () => items.filter((item) => !activeRenewalSourceIds.has(item.id)),
    [activeRenewalSourceIds, items],
  );

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

  const filteredCampaignClasses = useMemo(() => {
    const normalized = processSearch.trim().toLowerCase();
    const filtered = !campaignOverview
      ? []
      : campaignOverview.turmas.filter((turma) => {
          if (!normalized) return true;
          const alunos = turma.alunos.map((aluno) => aluno.alunoNome).join(' ');
          return `${turma.turmaNome} ${alunos}`.toLowerCase().includes(normalized);
        });

    if (classSort === 'PADRAO') return filtered;

    return [...filtered].sort((left, right) => {
      if (classSort === 'TURMA_ASC') {
        return left.turmaNome.localeCompare(right.turmaNome, 'pt-BR', {
          numeric: true,
          sensitivity: 'base',
        });
      }
      if (classSort === 'REMATRICULADOS_DESC') return right.confirmados - left.confirmados;
      return right.vagasDisponiveis - left.vagasDisponiveis;
    });
  }, [campaignOverview, classSort, processSearch]);

  const editingItem = useMemo(() => {
    if (!editingProcess) return null;
    const processItem = editingProcess.itens.find((item) => item.decision === 'RENEW') ?? editingProcess.itens[0];
    return processItem
      ? items.find((item) => item.id === processItem.matriculaOrigemId) ?? null
      : null;
  }, [editingProcess, items]);

  function capacityBadgeVariant(status: string): BadgeVariant {
    if (status === 'LOTADA' || status === 'EXCEDIDA') return 'destructive';
    if (status === 'PROXIMA_DO_LIMITE') return 'warning';
    return 'success';
  }

  function capacityLabel(status: string) {
    if (status === 'LOTADA') return 'Lotada';
    if (status === 'EXCEDIDA') return 'Acima da capacidade';
    if (status === 'PROXIMA_DO_LIMITE') return 'Próxima do limite';
    return 'Disponível';
  }

  const classColumns: DataTableColumn<RematriculaCampaignClassOverview>[] = [
    {
      id: 'turma',
      header: 'Turma',
      width: 'min-w-0 lg:w-[34%]',
      align: 'left',
      headerClassName: 'normal-case',
      noWrap: false,
      render: (turma) => (
        <span className="block truncate whitespace-nowrap text-[13px] font-medium text-slate-900">
          {turma.turmaNome}
        </span>
      ),
    },
    {
      id: 'ocupacao',
      header: 'Ocupação',
      width: 'lg:w-[34%]',
      align: 'left',
      headerClassName: 'normal-case',
      render: (turma) => (
        <div className="flex min-w-[260px] items-center gap-3">
          <span className="shrink-0 text-xs text-slate-500">
            {turma.ocupadas}/{turma.capacidade}
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-brand-accent/10">
            <div
              className="h-full rounded-full bg-brand-accent"
              style={{ width: `${Math.min(100, Math.max(0, turma.percentualOcupacao))}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'vagas',
      header: 'Vagas disponíveis',
      width: 'lg:w-[18%]',
      align: 'center',
      headerClassName: 'normal-case',
      render: (turma) => (
        <div className="whitespace-nowrap text-center text-sm">
          <span className="text-slate-900">{turma.vagasDisponiveis}</span>
          <span className="ml-1 text-xs text-slate-500">vagas</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'lg:w-[14%]',
      align: 'center',
      headerClassName: 'normal-case',
      render: (turma) => (
        <Badge variant={capacityBadgeVariant(turma.statusCapacidade)}>
          {capacityLabel(turma.statusCapacidade)}
        </Badge>
      ),
    },
  ];

  const studentColumns: DataTableColumn<RematriculaCampaignClassOverview['alunos'][number]>[] = [
    {
      id: 'aluno',
      header: 'Aluno',
      width: 'min-w-0 lg:w-[50%]',
      align: 'left',
      headerClassName: 'normal-case',
      noWrap: false,
      render: (aluno) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            {aluno.alunoFoto ? <AvatarImage src={aluno.alunoFoto} alt={aluno.alunoNome} /> : null}
            <AvatarFallback className="bg-violet-100 text-xs font-semibold text-violet-700">
              {getInitials(aluno.alunoNome)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 truncate text-[13px] font-medium text-slate-900">
            {aluno.alunoNome}
            <span className="font-normal text-slate-500">
              {' · '}
              {getReservationStatusLabel(aluno.reservaStatus) ?? 'Sem reserva'}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'lg:w-[25%]',
      align: 'center',
      headerClassName: 'normal-case',
      render: (aluno) => (
        <Badge variant={aluno.itemStatus === 'RENEWED' ? 'success' : 'warning'}>
          {aluno.itemStatus === 'RENEWED' ? 'Confirmado' : 'Pendente'}
        </Badge>
      ),
    },
    {
      id: 'processo',
      header: 'Processo',
      width: 'lg:w-[20%]',
      align: 'left',
      headerClassName: 'normal-case',
      render: (aluno) => <span className="text-xs text-slate-500">{getProcessStatusLabel(aluno.processoStatus)}</span>,
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[5rem]',
      align: 'right',
      headerClassName: 'normal-case pr-6',
      cellClassName: 'pr-6',
      render: (aluno) => {
        const process = processes.find((item) => item.id === aluno.processoId) ?? null;
        const processItem = process?.itens.find((item) => item.id === aluno.itemId) ?? null;
        const sourceItem = processItem
          ? items.find((item) => item.id === processItem.matriculaOrigemId) ?? null
          : null;

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  aria-label={`Ações da rematrícula de ${aluno.alunoNome}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem
                  disabled={!process}
                  onSelect={() => {
                    if (!process) return;
                    setSelectedClass(null);
                    setSelectedProcess(process);
                  }}
                >
                  Ver detalhes
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!process || !sourceItem}
                  onSelect={() => {
                    if (!process || !sourceItem) return;
                    setSelectedClass(null);
                    setEditingProcess(process);
                  }}
                >
                  Editar próximo ciclo
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!process || process.status === 'CANCELLED' || process.status === 'COMPLETED'}
                  className="text-red-600 focus:bg-red-50 focus:text-red-700 data-[highlighted]:bg-red-50"
                  onSelect={() => {
                    if (!process) return;
                    setSelectedClass(null);
                    setCancelReason('');
                    setCancelProcess(process);
                  }}
                >
                  Cancelar rematrícula
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  async function handleCancelProcess() {
    if (!cancelProcess || !cancelReason.trim()) return;

    try {
      setCancelSaving(true);
      await cancelRematriculaProcessRequest(cancelProcess.id, cancelReason.trim());
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Rematrícula cancelada"
          description="A matrícula atual foi preservada e a preparação do próximo ciclo foi cancelada."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setCancelProcess(null);
      setCancelReason('');
      setOverviewRefreshKey((current) => current + 1);
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível cancelar"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setCancelSaving(false);
    }
  }

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

  if (loading && !campaign) {
    return (
      <section className="mx-auto w-full max-w-4xl px-1 py-1 md:px-0 md:py-0">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
          Carregando campanha...
        </div>
      </section>
    );
  }

  if (!campaign) {
    return (
      <section className="mx-auto w-full max-w-4xl px-1 py-1 md:px-0 md:py-0">
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
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 px-4 py-6 pb-8">
          <section className="mx-auto w-full max-w-4xl">
            <div className="mb-8">
              <button
                type="button"
                className="mb-5 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
                onClick={() => router.push('/rematriculas')}
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </button>
              <div className="flex-1">
                <h1 className="mb-2 text-3xl font-bold leading-tight text-gray-900">
                  Detalhes da campanha
                </h1>
                <p className="text-base text-gray-600">
                  Organize adesões, reservas futuras e processos vinculados à campanha {campaign.nome}.
                </p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="rounded-xl border border-gray-200 bg-white px-6 py-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <Button
                    type="button"
                    className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 lg:w-auto"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Rematricular
                  </Button>

                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:w-[560px]">
                    <label className="relative block w-full">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={processSearch}
                        onChange={(event) => setProcessSearch(event.target.value)}
                        placeholder="Buscar por nome..."
                        className="h-10 rounded-lg border-gray-300 pl-10 shadow-none"
                      />
                    </label>
                    <Select value={classSort} onValueChange={(value) => setClassSort(value as typeof classSort)}>
                      <SelectTrigger
                        aria-label="Ordenar turmas"
                        className="h-10 w-full rounded-lg border-gray-300 bg-white px-3 text-slate-700 shadow-none sm:w-[190px]"
                      >
                        <span>Filtros</span>
                      </SelectTrigger>
                      <SelectContent align="end" className="text-[13px]">
                        <SelectItem value="PADRAO">Ordenação padrão</SelectItem>
                        <SelectItem value="TURMA_ASC">Turma (A-Z)</SelectItem>
                        <SelectItem value="REMATRICULADOS_DESC">Mais rematriculados</SelectItem>
                        <SelectItem value="VAGAS_DESC">Mais vagas disponíveis</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {overviewError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {overviewError}
                  </div>
                ) : null}
                {campaignOverview?.inconsistenciasSemTurma ? (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Existem {campaignOverview.inconsistenciasSemTurma} processo(s) com inconsistência de turma destino. Eles não foram contabilizados em uma turma.
                    </span>
                  </div>
                ) : null}
                <DataTable
                  columns={classColumns}
                  data={filteredCampaignClasses}
                  rowKey={(turma) => turma.turmaId}
                  loading={overviewLoading}
                  skeletonRows={4}
                  emptyMessage={
                    <div className="px-6 py-14 text-center text-sm text-slate-500">
                      Nenhuma turma com rematrículas encontrada.
                    </div>
                  }
                  containerClassName="rounded-xl border border-gray-200"
                  ariaLabel="Tabela de turmas da campanha de rematrícula"
                  onRowClick={(turma) => setSelectedClass(turma)}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedClass)}
        onOpenChange={(open) => {
          if (!open) setSelectedClass(null);
        }}
      >
        <DialogContent className="max-w-4xl gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0">
          <div className="px-6 pb-0 pt-5">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              {selectedClass?.turmaNome ?? 'Alunos da turma'}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Alunos rematriculados e respectivos status no próximo ciclo.
            </DialogDescription>
          </div>
          <div className="px-6 pb-6 pt-4">
            <DataTable
              columns={studentColumns}
              data={selectedClass?.alunos ?? []}
              rowKey={(aluno) => `${aluno.processoId}:${aluno.itemId}`}
              emptyMessage={
                <div className="px-6 py-12 text-center text-sm text-slate-500">
                  Nenhum aluno rematriculado nesta turma.
                </div>
              }
              containerClassName="rounded-xl border border-slate-200"
              ariaLabel="Tabela de alunos rematriculados da turma"
            />
          </div>
        </DialogContent>
      </Dialog>

      <RematriculaProcessDetailsDialog
        process={selectedProcess}
        onOpenChange={(open) => {
          if (!open) setSelectedProcess(null);
        }}
      />

      <RematriculaProcessCancelDialog
        process={cancelProcess}
        reason={cancelReason}
        saving={cancelSaving}
        onOpenChange={(open) => {
          if (!open && !cancelSaving) {
            setCancelProcess(null);
            setCancelReason('');
          }
        }}
        onReasonChange={setCancelReason}
        onConfirm={() => void handleCancelProcess()}
      />

      <RematriculaDialog
        mode="EDIT_FUTURE"
        open={Boolean(editingProcess && editingItem)}
        contaId={contaId ?? undefined}
        targetPeriodId={editingProcess?.targetPeriodId}
        item={editingItem}
        process={editingProcess}
        onOpenChange={(open) => {
          if (!open) setEditingProcess(null);
        }}
        onEdited={() => {
          setEditingProcess(null);
          setOverviewRefreshKey((current) => current + 1);
          void reload();
        }}
      />

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
          setOverviewRefreshKey((value) => value + 1);
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
          setOverviewRefreshKey((value) => value + 1);
        }}
      />
    </>
  );
}
