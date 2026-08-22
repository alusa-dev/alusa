'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Popover from '@radix-ui/react-popover';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { Button } from '@/components/ui/button';
import useCurrentUser from '@/hooks/use-current-user';
import { useRematriculas } from './hooks/use-rematriculas';
import { usePlatformBillingWriteAccess } from '@/hooks/use-platform-billing-write-access';
import type { RematriculaElegivelItem } from './services/rematriculas-service';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RematriculaDialog } from '@/components/matriculas/RematriculaDialog';
import { RematriculaFamiliarDialog } from '@/components/matriculas/RematriculaFamiliarDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  RematriculaProcessCancelDialog,
  RematriculaProcessDetailsDialog,
} from './components/RematriculaProcessDialogs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Edit3, MoreVertical, Search, Trash2, UserRound, UsersRound } from 'lucide-react';
import {
  cancelRematriculaProcessRequest,
  createRematriculaCampaignRequest,
  deleteRematriculaCampaignRequest,
  resolveRematriculaPendingRequest,
  updateRematriculaCampaignRequest,
  type RematriculaCampaignSummary,
  type RematriculaProcessSummary,
} from './services/rematriculas-service';

type QuickFilter = 'CAMPANHAS' | 'TODOS' | 'PENDENCIAS' | 'HISTORICO';
const DEFAULT_RENEWAL_LOOKAHEAD_DAYS = 365;

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

/** Lista legível em PT: "A e B" ou "A, B e C". */
function joinNamesPortuguese(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length === 0) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} e ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function formatDateOnly(date: Date | undefined) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getProcessLabel(status: RematriculaProcessSummary['status']) {
  const labels: Record<RematriculaProcessSummary['status'], string> = {
    DRAFT: 'Rascunho',
    PREVIEWED: 'Prévia',
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
  if (status === 'CONFIRMED' || status === 'EFFECTIVE') return 'success';
  if (status === 'WAITING_FOR_START' || status === 'PREVIEWED') return 'info';
  if (status === 'PARTIALLY_CONFIRMED' || status === 'REQUIRES_ATTENTION') return 'warning';
  if (status === 'CANCELLED') return 'destructive';
  return 'neutral';
}

function getProcessStudentNames(process: RematriculaProcessSummary) {
  return process.itens
    .map((item) => item.aluno?.nome)
    .filter((name): name is string => Boolean(name));
}

function getProcessTitle(process: RematriculaProcessSummary) {
  const names = getProcessStudentNames(process);
  if (names.length === 0) return `Processo ${process.id.slice(0, 8)}`;
  if (process.holderType === 'RESPONSIBLE' && names.length > 1) return 'Grupo familiar';
  return names[0];
}

function getProcessSubtitle(process: RematriculaProcessSummary) {
  if (process.holderType === 'RESPONSIBLE') return 'Responsável financeiro';
  return 'Aluno titular';
}

function isProcessEditable(process: RematriculaProcessSummary) {
  if (['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(process.status)) return false;
  const effectiveAt = new Date(process.effectiveAt);
  if (Number.isNaN(effectiveAt.getTime())) return true;
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const effectiveOnly = new Date(
    effectiveAt.getFullYear(),
    effectiveAt.getMonth(),
    effectiveAt.getDate(),
  ).getTime();
  return todayOnly < effectiveOnly;
}

function isProcessCancelled(process: RematriculaProcessSummary) {
  return process.status === 'CANCELLED';
}

function campaignStatusLabel(status: RematriculaCampaignSummary['status']) {
  const labels: Record<RematriculaCampaignSummary['status'], string> = {
    DRAFT: 'Rascunho',
    SCHEDULED: 'Agendada',
    ACTIVE: 'Ativa',
    PAUSED: 'Pausada',
    CLOSED: 'Fechada',
    DELETED: 'Excluída',
    ARCHIVED: 'Arquivada',
  };
  return labels[status] ?? status;
}

function getCampaignBadgeVariant(status: RematriculaCampaignSummary['status']): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SCHEDULED') return 'info';
  if (status === 'PAUSED') return 'warning';
  if (status === 'ARCHIVED' || status === 'DELETED') return 'destructive';
  return 'neutral';
}

function getCampaignAccentClasses(index: number) {
  const accents = [
    {
      dot: 'bg-violet-100',
      bar: 'bg-violet-600',
    },
    {
      dot: 'bg-orange-100',
      bar: 'bg-orange-500',
    },
    {
      dot: 'bg-slate-100',
      bar: 'bg-slate-300',
    },
  ];
  return accents[index % accents.length];
}

function getCampaignProgress(campaign: RematriculaCampaignSummary, processes: RematriculaProcessSummary[]) {
  const campaignProcesses = processes.filter((process) => process.campanhaId === campaign.id);
  const activeProcesses = campaignProcesses.filter((process) => process.status !== 'CANCELLED');
  const confirmed = activeProcesses.filter((process) =>
    ['CONFIRMED', 'WAITING_FOR_START', 'EFFECTIVE', 'COMPLETED'].includes(process.status),
  ).length;
  const waiting = activeProcesses.filter((process) => process.status === 'WAITING_FOR_START').length;
  const attention = activeProcesses.filter((process) => process.status === 'REQUIRES_ATTENTION').length;
  const effective = activeProcesses.filter((process) => process.status === 'EFFECTIVE').length;
  const total = Math.max(campaign.metrics.participantes, activeProcesses.length);
  if (total <= 0) return { confirmed, waiting, attention, effective, total, percentage: 0 };
  return {
    confirmed,
    waiting,
    attention,
    effective,
    total,
    percentage: Math.min(100, Math.max(0, Math.round((confirmed / total) * 100))),
  };
}

function getGroupCanRenew(group: RematriculaTitularGroup) {
  return group.itens.some(
    (item) => item.podeRenovar && item.financeiro.rematriculaActionStatus !== 'BLOQUEADA',
  );
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

function buildEditProcessItem(process: RematriculaProcessSummary | null): RematriculaElegivelItem | null {
  if (!process) return null;
  const item = process.itens.find((processItem) => processItem.decision === 'RENEW') ?? process.itens[0];
  if (!item?.aluno) return null;
  const currentEnrollment = item.matriculaAtual;
  const futureEnrollment = item.matriculaFutura;
  const currentContractStart = currentEnrollment?.dataInicio ?? process.createdAt;
  const currentContractEnd = currentEnrollment?.dataFimContrato ?? process.effectiveAt;

  return {
    id: item.matriculaOrigemId,
    status: currentEnrollment?.status === 'ATIVA' ? 'ATIVA' : 'AGUARDANDO_CONFIRMACAO',
    statusContrato:
      currentEnrollment?.statusContrato === 'ATIVO' ||
      currentEnrollment?.statusContrato === 'EXPIRADO' ||
      currentEnrollment?.statusContrato === 'CANCELADO'
        ? currentEnrollment.statusContrato
        : 'AGUARDANDO_ASSINATURA',
    dataInicio: currentContractStart,
    dataFimContrato: currentContractEnd,
    diasRestantes: 0,
    contratoExpirado: false,
    podeRenovar: true,
    eligibilityStatus: 'ELEGIVEL',
    aluno: {
      id: item.aluno.id,
      nome: item.aluno.nome,
      cpf: item.aluno.cpf ?? null,
      foto: item.aluno.foto ?? null,
    },
    responsavelFinanceiro: null,
    plano: item.planoAtual ?? { id: item.targetPlanId ?? '', nome: 'Plano atual' },
    turma: item.turmaAtual
      ? { ...item.turmaAtual, diasSemana: [], horaInicio: '', horaFim: '' }
      : null,
    combo: item.comboAtual ?? null,
    financeiro: {
      pendencias: process.pendencias.length,
      cobrancasEmAberto: 0,
      cobrancasAtrasadas: 0,
      financialStatus: 'REGULAR',
      rematriculaActionStatus: 'LIBERADA',
      blockReason: 'SEM_BLOQUEIO',
      actionMessage: '',
      canCurrentUserOverride: false,
      requiresOverrideReason: true,
      shouldBlockNewFinancialCycle: false,
      formaPagamento:
        futureEnrollment?.formaPagamento === 'BOLETO' ||
        futureEnrollment?.formaPagamento === 'PIX' ||
        futureEnrollment?.formaPagamento === 'CARTAO_CREDITO' ||
        futureEnrollment?.formaPagamento === 'INDEFINIDO'
          ? futureEnrollment.formaPagamento
          : null,
      formaPagamentoTaxa:
        futureEnrollment?.formaPagamentoTaxa === 'BOLETO' ||
        futureEnrollment?.formaPagamentoTaxa === 'PIX' ||
        futureEnrollment?.formaPagamentoTaxa === 'CARTAO_CREDITO' ||
        futureEnrollment?.formaPagamentoTaxa === 'INDEFINIDO'
          ? futureEnrollment.formaPagamentoTaxa
          : null,
      vencimentoDia:
        futureEnrollment?.vencimentoDia ??
        (process.firstDueDate ? new Date(process.firstDueDate).getUTCDate() : null),
      taxaMatricula: futureEnrollment?.taxaMatricula ?? process.enrollmentFeeTotal,
      taxaIsenta: futureEnrollment?.taxaIsenta ?? process.enrollmentFeeTotal <= 0,
      taxaJustificativa: futureEnrollment?.taxaJustificativa ?? null,
      multaPercentual: futureEnrollment?.multaPercentual ?? null,
      jurosMensal: futureEnrollment?.jurosMensal ?? null,
      descontoAntecipado: futureEnrollment?.descontoAntecipado ?? null,
      descontoTipo: null,
      prazoDesconto: futureEnrollment?.prazoDesconto ?? null,
      diasTolerancia: null,
      descontos: [],
    },
  };
}

export default function RematriculasFeature() {
  const { canWrite, loading: billingLoading } = usePlatformBillingWriteAccess();
  const router = useRouter();
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('CAMPANHAS');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<'TODOS' | RematriculaCampaignSummary['status']>('TODOS');
  const [campaignPeriodFilter, setCampaignPeriodFilter] = useState('TODOS');
  const [processStatusFilter, setProcessStatusFilter] = useState<'TODOS' | RematriculaProcessSummary['status']>('TODOS');
  const [processOriginFilter, setProcessOriginFilter] = useState<'TODOS' | RematriculaProcessSummary['origin']>('TODOS');
  const [processPeriodFilter, setProcessPeriodFilter] = useState('TODOS');
  const [standaloneSearchOpen, setStandaloneSearchOpen] = useState(false);
  const [standaloneCloseAlertOpen, setStandaloneCloseAlertOpen] = useState(false);
  const [standaloneSearch, setStandaloneSearch] = useState('');
  const [selectedStandaloneGroupId, setSelectedStandaloneGroupId] = useState<string | null>(null);
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [selectedTitular, setSelectedTitular] = useState<RematriculaTitularGroup | null>(null);
  const [campaignFormOpen, setCampaignFormOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [campaignPeriod, setCampaignPeriod] = useState(String(new Date().getFullYear() + 1));
  const [campaignStartsAt, setCampaignStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [campaignEndsAt, setCampaignEndsAt] = useState('');
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<RematriculaCampaignSummary | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<RematriculaProcessSummary | null>(null);
  const [editingProcess, setEditingProcess] = useState<RematriculaProcessSummary | null>(null);
  const [renewAgainProcess, setRenewAgainProcess] = useState<RematriculaProcessSummary | null>(null);
  const [cancelProcess, setCancelProcess] = useState<RematriculaProcessSummary | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);

  function closeStandaloneSearch() {
    setStandaloneSearchOpen(false);
    setStandaloneSearch('');
    setSelectedStandaloneGroupId(null);
    setStandaloneCloseAlertOpen(false);
  }

  function requestCloseStandaloneSearch() {
    if (standaloneSearch.trim() || selectedStandaloneGroupId) {
      setStandaloneCloseAlertOpen(true);
      return;
    }
    closeStandaloneSearch();
  }

  const modalControlClass =
    'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
  const modalTextAreaClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
  const modalSectionClass =
    'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
  const modalLabelClass = 'text-xs font-medium text-slate-600';

  const { items, loading, reload, campaigns, processes, history } = useRematriculas({
    contaId,
    diasAntecedencia: DEFAULT_RENEWAL_LOOKAHEAD_DAYS,
  });

  const quickFilterOptions: Array<{ label: string; value: QuickFilter }> = [
    { label: 'Campanhas', value: 'CAMPANHAS' },
    { label: 'Todos os processos', value: 'TODOS' },
    { label: 'Pendências', value: 'PENDENCIAS' },
    { label: 'Histórico', value: 'HISTORICO' },
  ];

  const activeRenewalSourceIds = useMemo(() => {
    return new Set(
      processes
        .filter((process) => process.status !== 'CANCELLED')
        .flatMap((process) => process.itens.map((item) => item.matriculaOrigemId)),
    );
  }, [processes]);

  const availableItems = useMemo(
    () => items.filter((item) => !activeRenewalSourceIds.has(item.id)),
    [activeRenewalSourceIds, items],
  );

  const groupedItems = useMemo(() => buildTitularGroups(availableItems), [availableItems]);

  const filteredStandaloneGroups = useMemo(() => {
    const normalizedSearch = standaloneSearch.trim().toLowerCase();
    if (!normalizedSearch) return groupedItems;
    return groupedItems.filter((group) => {
      const students = group.itens
        .map((item) => item.aluno.nome)
        .filter(Boolean)
        .join(' ');
      return `${group.titular.nome} ${group.titular.cpf ?? ''} ${students}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [groupedItems, standaloneSearch]);

  const standaloneSuggestions = useMemo(() => {
    if (!standaloneSearch.trim() || selectedStandaloneGroupId) return [];
    return filteredStandaloneGroups.slice(0, 6);
  }, [filteredStandaloneGroups, selectedStandaloneGroupId, standaloneSearch]);

  const selectedStandaloneGroup = useMemo(
    () => groupedItems.find((group) => group.id === selectedStandaloneGroupId) ?? null,
    [groupedItems, selectedStandaloneGroupId],
  );

  function processMatchesCurrentFilters(process: RematriculaProcessSummary, normalizedSearch: string) {
    const studentNames = getProcessStudentNames(process).join(' ');
    const searchable = [
      process.id,
      process.campanha?.nome,
      process.targetPeriodId,
      studentNames,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
    const matchesStatus =
      processStatusFilter === 'TODOS' || process.status === processStatusFilter;
    const matchesOrigin =
      processOriginFilter === 'TODOS' || process.origin === processOriginFilter;
    const matchesPeriod =
      processPeriodFilter === 'TODOS' || process.targetPeriodId === processPeriodFilter;
    return matchesSearch && matchesStatus && matchesOrigin && matchesPeriod;
  }

  const filteredProcesses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return processes.filter((process) => processMatchesCurrentFilters(process, normalizedSearch));
  }, [processOriginFilter, processPeriodFilter, processStatusFilter, processes, search]);

  const filteredPendingProcesses = useMemo(() => {
    return filteredProcesses.filter((process) =>
      process.pendencias.some((pending) => ['OPEN', 'IN_PROGRESS'].includes(pending.status)),
    );
  }, [filteredProcesses]);

  const filteredHistoryProcesses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return history.filter((process) => processMatchesCurrentFilters(process, normalizedSearch));
  }, [history, processOriginFilter, processPeriodFilter, processStatusFilter, search]);

  const campaignPeriodOptions = useMemo(() => {
    return Array.from(new Set(campaigns.map((campaign) => campaign.targetPeriodId).filter(Boolean))).sort();
  }, [campaigns]);

  const processPeriodOptions = useMemo(() => {
    return Array.from(
      new Set([...processes, ...history].map((process) => process.targetPeriodId).filter(Boolean)),
    ).sort();
  }, [history, processes]);

  const filteredCampaigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = campaigns.filter((campaign) => {
      const matchesSearch =
        !normalizedSearch ||
        campaign.nome.toLowerCase().includes(normalizedSearch) ||
        campaign.targetPeriodId.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        campaignStatusFilter === 'TODOS' || campaign.status === campaignStatusFilter;
      const matchesPeriod =
        campaignPeriodFilter === 'TODOS' || campaign.targetPeriodId === campaignPeriodFilter;
      return matchesSearch && matchesStatus && matchesPeriod;
    });

    return filtered;
  }, [campaignPeriodFilter, campaignStatusFilter, campaigns, search]);

  function resetCampaignForm() {
    setCampaignName('');
    setCampaignDescription('');
    setCampaignPeriod(String(new Date().getFullYear() + 1));
    setCampaignStartsAt(new Date().toISOString().slice(0, 10));
    setCampaignEndsAt('');
    setEditingCampaign(null);
  }

  function toDateInputValue(value: string | null | undefined) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatDateOnly(date);
  }

  function openEditCampaignModal(campaign: RematriculaCampaignSummary) {
    setEditingCampaign(campaign);
    setCampaignName(campaign.nome);
    setCampaignDescription(campaign.descricao ?? '');
    setCampaignPeriod(campaign.targetPeriodId);
    setCampaignStartsAt(toDateInputValue(campaign.campaignStartsAt));
    setCampaignEndsAt(toDateInputValue(campaign.campaignEndsAt));
    setCampaignFormOpen(true);
  }

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!campaignName.trim() || !campaignPeriod.trim() || !campaignStartsAt) return;
    try {
      setCampaignSaving(true);
      const payload = {
        nome: campaignName.trim(),
        descricao: campaignDescription.trim() || null,
        targetPeriodId: campaignPeriod.trim(),
        campaignStartsAt,
        campaignEndsAt: campaignEndsAt || null,
        audienceDefinition: {
          type: 'ALL_ACTIVE_ENROLLMENTS',
          diasAntecedencia: DEFAULT_RENEWAL_LOOKAHEAD_DAYS,
          filters: {
            academicStatus: ['ATIVO'],
            financialStatus: ['ADIMPLENTE', 'COM_PENDENCIA_PERMITIDA'],
          },
        },
      };
      if (editingCampaign) {
        await updateRematriculaCampaignRequest(editingCampaign.id, payload);
      } else {
        await createRematriculaCampaignRequest(payload);
      }
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title={editingCampaign ? 'Campanha atualizada' : 'Campanha criada'}
          description={
            editingCampaign
              ? 'Os dados da campanha foram salvos.'
              : 'A campanha foi criada ativa.'
          }
          onClose={() => toast.dismiss(t)}
        />
      ));
      setCampaignFormOpen(false);
      resetCampaignForm();
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title={editingCampaign ? 'Não foi possível salvar' : 'Não foi possível criar a campanha'}
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setCampaignSaving(false);
    }
  }

  async function handleArchiveCampaign(campaign: RematriculaCampaignSummary) {
    const confirmed = window.confirm(`Excluir a campanha "${campaign.nome}"?`);
    if (!confirmed) return;

    try {
      const result = await deleteRematriculaCampaignRequest(campaign.id);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Campanha excluída"
          description={
            result.mode === 'HARD_DELETE'
              ? 'A campanha foi removida definitivamente.'
              : 'A campanha foi excluída e o histórico foi preservado.'
          }
          onClose={() => toast.dismiss(t)}
        />
      ));
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível excluir"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  async function handleCancelProcess() {
    if (!cancelProcess || !cancelReason.trim()) return;
    try {
      setCancelSaving(true);
      const result = await cancelRematriculaProcessRequest(cancelProcess.id, cancelReason.trim());
      const remoteStatus = result.remoteCancellation?.status ?? 'NOT_NEEDED';
      const needsFinancialReview =
        remoteStatus === 'REQUIRES_RECONCILIATION' || remoteStatus === 'FAILED';
      toast.custom((t) => (
        <CustomToast
          variant={needsFinancialReview ? 'warning' : 'success'}
          title={needsFinancialReview ? 'Rematrícula cancelada com conferência financeira' : 'Rematrícula cancelada'}
          description={
            needsFinancialReview
              ? 'A matrícula atual foi preservada. O financeiro futuro precisa de conferência operacional.'
              : 'A matrícula atual foi preservada e a preparação do próximo ciclo foi cancelada.'
          }
          onClose={() => toast.dismiss(t)}
        />
      ));
      setSelectedProcess((current) => (current?.id === cancelProcess.id ? null : current));
      setCancelProcess(null);
      setCancelReason('');
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

  async function handleResolvePending(pendingId: string) {
    const resolution = window.prompt('Informe a resolução da pendência:');
    if (!resolution?.trim()) return;

    try {
      await resolveRematriculaPendingRequest(pendingId, { resolution: resolution.trim() });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Pendência resolvida"
          description="A resolução foi registrada na auditoria."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setSelectedProcess(null);
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível resolver"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  function startStandaloneRenewal(group: RematriculaTitularGroup | null) {
    if (!group) return;
    if (!getGroupCanRenew(group)) {
      toast.custom((t) => (
        <CustomToast
          variant="warning"
          title="Rematrícula indisponível"
          description="Nenhum aluno elegível para rematrícula neste titular."
          onClose={() => toast.dismiss(t)}
        />
      ));
      return;
    }
    setStandaloneSearchOpen(false);
    setStandaloneSearch('');
    setSelectedStandaloneGroupId(null);
    if (group.tipo === 'RESPONSAVEL') {
      setSelectedTitular(group);
      return;
    }
    setSelectedMatricula(group.itens[0] ?? null);
  }

  function startRenewalAgain(process: RematriculaProcessSummary) {
    const item = buildEditProcessItem(process);
    if (!item) {
      toast.custom((t) => (
        <CustomToast
          variant="warning"
          title="Rematrícula indisponível"
          description="Não foi possível recuperar a matrícula de origem deste processo."
          onClose={() => toast.dismiss(t)}
        />
      ));
      return;
    }
    setRenewAgainProcess(process);
  }

  function openProcessDetails(process: RematriculaProcessSummary) {
    setSelectedProcess(process);
  }

  const processColumns: DataTableColumn<RematriculaProcessSummary>[] = [
    {
      id: 'titular',
      header: 'Aluno / responsável',
      width: 'min-w-0 lg:w-[30%]',
      align: 'left',
      noWrap: false,
      render: (process) => {
        const title = getProcessTitle(process);
        const studentNames = getProcessStudentNames(process);
        const firstStudent = process.itens.find((item) => item.aluno)?.aluno;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              {firstStudent?.foto ? (
                <AvatarImage src={firstStudent.foto} alt={firstStudent.nome} />
              ) : null}
              <AvatarFallback className="bg-purple-100 text-xs font-semibold text-purple-700">
                {getInitials(title)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-normal text-gray-900" title={studentNames.join(' / ')}>
                {title}
              </div>
              <div className="truncate text-xs text-gray-500">
                {getProcessSubtitle(process)}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'vinculo',
      header: 'Vínculo atual',
      width: 'min-w-0 lg:w-[20%]',
      align: 'left',
      noWrap: false,
      render: (process) => {
        const vinculos = process.itens
          .map((item) => item.turmaAtual?.nome ?? item.comboAtual?.nome)
          .filter((value): value is string => Boolean(value));
        return (
          <div className="min-w-0">
            <div className="truncate text-sm text-gray-900" title={vinculos.join(' / ')}>
              {joinNamesPortuguese(vinculos) || 'Sem turma atual'}
            </div>
          </div>
        );
      },
    },
    {
      id: 'origem',
      header: 'Origem',
      width: 'lg:w-[22%]',
      align: 'left',
      render: (process) => (
        <span className="block truncate text-sm text-gray-700">
          {process.origin === 'CAMPAIGN' ? process.campanha?.nome ?? 'Campanha' : 'Avulsa'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'lg:w-[18%]',
      align: 'center',
      render: (process) => (
        <Badge variant={getProcessBadgeVariant(process.status)}>
          {getProcessLabel(process.status)}
        </Badge>
      ),
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[5rem]',
      align: 'right',
      headerClassName: 'pr-6 md:pr-8',
      cellClassName: 'pr-6 md:pr-8',
      render: (process) => {
        const firstOpenPending = process.pendencias.find((pending) =>
          ['OPEN', 'IN_PROGRESS'].includes(pending.status),
        );
        const cancelled = isProcessCancelled(process);
        const editable = isProcessEditable(process);
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  aria-label={`Ações do processo ${process.id}`}
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
                <DropdownMenuItem onSelect={() => openProcessDetails(process)}>
                  Ver detalhes
                </DropdownMenuItem>
                {cancelled ? (
                  <DropdownMenuItem onSelect={() => startRenewalAgain(process)}>
                    Rematricular novamente
                  </DropdownMenuItem>
                ) : null}
                {editable ? (
                  <DropdownMenuItem onSelect={() => setEditingProcess(process)}>
                    Editar próximo ciclo
                  </DropdownMenuItem>
                ) : null}
                {firstOpenPending ? (
                  <DropdownMenuItem onSelect={() => void handleResolvePending(firstOpenPending.id)}>
                    Resolver pendência
                  </DropdownMenuItem>
                ) : null}
                {editable ? (
                  <DropdownMenuItem
                    className="text-red-600 focus:bg-red-50 data-[highlighted]:bg-red-50"
                    onSelect={() => {
                      setCancelProcess(process);
                      setCancelReason('');
                    }}
                  >
                    Cancelar rematrícula
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const historyColumns: DataTableColumn<RematriculaProcessSummary>[] = [
    ...processColumns.slice(0, -1),
    {
      id: 'data',
      header: 'Registro',
      width: 'lg:w-[12%]',
      align: 'left',
      render: (process) => (
        <span className="block truncate text-sm text-gray-700">
          {formatDate(process.createdAt)}
        </span>
      ),
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[5rem]',
      align: 'right',
      headerClassName: 'pr-6 md:pr-8',
      cellClassName: 'pr-6 md:pr-8',
      render: (process) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label={`Ações do histórico ${process.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40"
              onClick={(event) => event.stopPropagation()}
            >
                <DropdownMenuItem onSelect={() => openProcessDetails(process)}>
                Ver detalhes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const campaignColumns: DataTableColumn<RematriculaCampaignSummary>[] = [
    {
      id: 'campanha',
      header: 'Campanha',
      width: 'min-w-0 lg:w-[30%]',
      align: 'left',
      noWrap: false,
      render: (campaign) => {
        const index = filteredCampaigns.findIndex((item) => item.id === campaign.id);
        const accent = getCampaignAccentClasses(index < 0 ? 0 : index);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className={`h-10 w-10 shrink-0 rounded-full ${accent.dot}`}
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-normal text-gray-900">
                {campaign.nome}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'rematriculados',
      header: 'Rematriculados',
      width: 'lg:w-[14%]',
      align: 'left',
      render: (campaign) => {
        const progress = getCampaignProgress(campaign, processes);
        return <span className="text-gray-700">{progress.confirmed}</span>;
      },
    },
    {
      id: 'periodo',
      header: 'Período de destino',
      width: 'lg:w-[14%]',
      align: 'left',
      render: (campaign) => (
        <span className="leading-[20px] text-gray-700">{campaign.targetPeriodId}</span>
      ),
    },
    {
      id: 'janela',
      header: 'Janela da campanha',
      width: 'lg:w-[20%]',
      align: 'left',
      render: (campaign) => (
        <span className="leading-[20px] text-gray-700">
          {formatDate(campaign.campaignStartsAt)} — {formatDate(campaign.campaignEndsAt)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'lg:w-[14%]',
      align: 'left',
      render: (campaign) => (
        <Badge variant={getCampaignBadgeVariant(campaign.status)}>
          {campaignStatusLabel(campaign.status)}
        </Badge>
      ),
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-[6rem] lg:w-[8%]',
      align: 'center',
      headerClassName: 'pr-6 md:pr-8',
      cellClassName: 'pr-6 md:pr-8',
      render: (campaign) => (
        <div className="flex justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label={`Ações da campanha ${campaign.nome}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => openEditCampaignModal(campaign)}>
                <Edit3 className="mr-2 h-4 w-4 text-slate-500" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:bg-red-50 data-[highlighted]:bg-red-50"
                onSelect={() => void handleArchiveCampaign(campaign)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const showCampaigns = quickFilter === 'CAMPANHAS';
  const showProcesses = quickFilter === 'TODOS';
  const showPending = quickFilter === 'PENDENCIAS';
  const showHistory = quickFilter === 'HISTORICO';
  const showProcessFilters = showProcesses || showPending || showHistory;

  return (
    <>
      <section className="w-full px-1 py-1 md:px-0 md:py-0">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-normal text-slate-950 md:text-[24px]">
              Gestão de Rematrículas
            </h1>
            <p className="mt-2 text-[13px] font-medium text-slate-500">
              Organize campanhas, acompanhe adesão e gerencie processos de renovação.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full rounded-lg border-slate-200 bg-white px-4 text-slate-700 shadow-none hover:bg-slate-50 md:w-auto"
              disabled={billingLoading || !canWrite}
              onClick={() => {
                setStandaloneSearch('');
                setSelectedStandaloneGroupId(null);
                setStandaloneSearchOpen(true);
              }}
            >
              Rematrícula avulsa
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
              disabled={billingLoading || !canWrite}
              onClick={() => {
                setQuickFilter('CAMPANHAS');
                resetCampaignForm();
                setCampaignFormOpen(true);
              }}
            >
              Criar campanha
            </Button>
          </div>
        </div>

        <div className="border-b border-slate-200">
          <div className="flex flex-wrap items-end gap-7">
            {quickFilterOptions.map((option) => {
              const selected = quickFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`relative h-11 px-4 text-[15px] font-medium transition-colors ${
                    selected ? 'text-slate-950' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  onClick={() => setQuickFilter(option.value)}
                >
                  {option.label}
                  {selected ? (
                    <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-[#6d35bb]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 space-y-7">
          {showCampaigns ? (
            <div className="space-y-7">
              <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-2">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome da campanha"
                      className="h-10 w-full rounded-lg border-slate-200 pl-10 shadow-none lg:w-[360px] xl:w-[420px]"
                    />
                  </label>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:items-center lg:justify-end">
                  <Select
                    value={campaignStatusFilter}
                    onValueChange={(value) =>
                      setCampaignStatusFilter(value as 'TODOS' | RematriculaCampaignSummary['status'])
                    }
                  >
                    <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[170px]">
                      <SelectValue placeholder="Todos os status" />
                    </SelectTrigger>
                    <SelectContent align="end" className="text-[13px]">
                      <SelectItem value="TODOS">Todos os status</SelectItem>
                      <SelectItem value="ACTIVE">Ativa</SelectItem>
                      <SelectItem value="PAUSED">Pausada</SelectItem>
                      <SelectItem value="DRAFT">Rascunho</SelectItem>
                      <SelectItem value="SCHEDULED">Agendada</SelectItem>
                      <SelectItem value="CLOSED">Fechada</SelectItem>
                      <SelectItem value="ARCHIVED">Arquivada</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={campaignPeriodFilter}
                    onValueChange={setCampaignPeriodFilter}
                  >
                    <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[170px]">
                      <SelectValue placeholder="Todos os períodos" />
                    </SelectTrigger>
                    <SelectContent align="end" className="text-[13px]">
                      <SelectItem value="TODOS">Todos os períodos</SelectItem>
                      {campaignPeriodOptions.map((period) => (
                        <SelectItem key={period} value={period}>
                          {period}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:rounded-xl">
                <DataTable
                  columns={campaignColumns}
                  data={filteredCampaigns}
                  rowKey={(campaign) => campaign.id}
                  loading={loading}
                  skeletonRows={3}
                  emptyMessage={
                    <div className="px-6 py-12 text-center text-gray-500">
                      Nenhuma campanha encontrada para os filtros atuais.
                    </div>
                  }
                  ariaLabel="Tabela de campanhas de rematrícula"
                  onRowClick={(campaign) => router.push(`/rematriculas/campanhas/${campaign.id}`)}
                />
              </div>
            </div>
          ) : null}

          {showProcessFilters ? (
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por aluno, campanha ou período"
                  className="h-10 w-full rounded-lg border-slate-200 pl-10 shadow-none lg:w-[360px] xl:w-[420px]"
                />
              </label>
              <div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:items-center lg:justify-end">
                <Select
                  value={processStatusFilter}
                  onValueChange={(value) =>
                    setProcessStatusFilter(value as 'TODOS' | RematriculaProcessSummary['status'])
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[170px]">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent align="end" className="text-[13px]">
                    <SelectItem value="TODOS">Todos os status</SelectItem>
                    <SelectItem value="DRAFT">Rascunho</SelectItem>
                    <SelectItem value="PREVIEWED">Prévia</SelectItem>
                    <SelectItem value="PARTIALLY_CONFIRMED">Parcial</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmada</SelectItem>
                    <SelectItem value="WAITING_FOR_START">Aguardando início</SelectItem>
                    <SelectItem value="REQUIRES_ATTENTION">Requer atenção</SelectItem>
                    <SelectItem value="EFFECTIVE">Novo ciclo iniciado</SelectItem>
                    <SelectItem value="COMPLETED">Encerrada</SelectItem>
                    <SelectItem value="CANCELLED">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={processOriginFilter}
                  onValueChange={(value) =>
                    setProcessOriginFilter(value as 'TODOS' | RematriculaProcessSummary['origin'])
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[150px]">
                    <SelectValue placeholder="Todas as origens" />
                  </SelectTrigger>
                  <SelectContent align="end" className="text-[13px]">
                    <SelectItem value="TODOS">Todas as origens</SelectItem>
                    <SelectItem value="CAMPAIGN">Campanha</SelectItem>
                    <SelectItem value="STANDALONE">Avulsa</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={processPeriodFilter}
                  onValueChange={setProcessPeriodFilter}
                >
                  <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[170px]">
                    <SelectValue placeholder="Todos os períodos" />
                  </SelectTrigger>
                  <SelectContent align="end" className="text-[13px]">
                    <SelectItem value="TODOS">Todos os períodos</SelectItem>
                    {processPeriodOptions.map((period) => (
                      <SelectItem key={period} value={period}>
                        {period}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {showProcesses ? (
            <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:rounded-xl">
              <DataTable
                columns={processColumns}
                data={filteredProcesses}
                rowKey={(process) => process.id}
                loading={loading}
                skeletonRows={4}
                emptyMessage={
                  <div className="px-6 py-12 text-center text-gray-500">
                    {loading
                      ? 'Carregando processos...'
                      : 'Nenhum processo de rematrícula encontrado para os filtros atuais.'}
                  </div>
                }
                ariaLabel="Tabela de processos de rematrícula"
                onRowClick={(process) => openProcessDetails(process)}
              />
            </div>
          ) : null}

          {showPending ? (
            <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:rounded-xl">
              <DataTable
                columns={processColumns}
                data={filteredPendingProcesses}
                rowKey={(process) => process.id}
                loading={loading}
                skeletonRows={4}
                emptyMessage={
                  <div className="px-6 py-12 text-center text-gray-500">
                    {loading
                      ? 'Carregando pendências...'
                      : 'Nenhuma pendência de rematrícula encontrada para os filtros atuais.'}
                  </div>
                }
                ariaLabel="Tabela de pendências de rematrícula"
                onRowClick={(process) => openProcessDetails(process)}
              />
            </div>
          ) : null}

          {showHistory ? (
            <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:rounded-xl">
              <DataTable
                columns={historyColumns}
                data={filteredHistoryProcesses}
                rowKey={(process) => process.id}
                loading={loading}
                skeletonRows={4}
                emptyMessage={
                  <div className="px-6 py-12 text-center text-gray-500">
                    {loading
                      ? 'Carregando histórico...'
                      : 'Nenhum histórico de rematrícula encontrado para os filtros atuais.'}
                  </div>
                }
                ariaLabel="Tabela de histórico de rematrícula"
                onRowClick={(process) => openProcessDetails(process)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <RematriculaProcessDetailsDialog
        process={selectedProcess}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProcess(null);
          }
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

      <Dialog
        open={standaloneSearchOpen}
        onOpenChange={(open) => {
          if (open) setStandaloneSearchOpen(true);
          else requestCloseStandaloneSearch();
        }}
      >
        <DialogContent className="w-full max-w-2xl gap-0 overflow-hidden bg-white p-0 md:rounded-2xl">
          <div className="border-b border-slate-200 px-6 py-5">
            <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
              Rematrícula avulsa
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              Selecione um aluno ou responsável com matrícula ativa para preparar o próximo ciclo.
            </DialogDescription>
          </div>

          <div className="space-y-4 px-6 py-5">
            <Popover.Root open={Boolean(standaloneSearch.trim()) && !selectedStandaloneGroupId}>
              <Popover.Anchor asChild>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={standaloneSearch}
                    onChange={(event) => {
                      setStandaloneSearch(event.target.value);
                      setSelectedStandaloneGroupId(null);
                    }}
                    placeholder="Buscar aluno ou responsável"
                    className="h-10 w-full rounded-lg border-slate-200 pl-10 shadow-none focus:border-[#5c2f91] focus:ring-2 focus:ring-[#5c2f91]/30"
                    aria-autocomplete="list"
                    aria-expanded={Boolean(standaloneSearch.trim()) && !selectedStandaloneGroupId}
                  />
                </label>
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content
                  className="z-[99999] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                  sideOffset={4}
                  align="start"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="max-h-[360px] overflow-y-auto">
                    {standaloneSuggestions.length === 0 ? (
                      <div className="px-4 py-3 text-center text-sm text-slate-500">
                        {loading
                          ? 'Carregando candidatos...'
                          : 'Nenhum candidato disponível para rematrícula avulsa.'}
                      </div>
                    ) : (
                      standaloneSuggestions.map((group) => {
                        const studentNames = group.itens
                          .map((item) => item.aluno.nome)
                          .filter(Boolean)
                          .join(', ');
                        return (
                          <button
                            key={group.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 border-b border-gray-100 bg-white px-3 py-2.5 text-left text-sm text-gray-900 transition last:border-b-0 hover:bg-gray-50"
                            onClick={() => {
                              setSelectedStandaloneGroupId(group.id);
                              setStandaloneSearch(group.titular.nome);
                            }}
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-gray-900">
                                {group.titular.nome}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-gray-500">
                                {studentNames || (group.tipo === 'RESPONSAVEL' ? 'Responsável' : 'Aluno')}
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
                          </button>
                        );
                    })
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            {selectedStandaloneGroup ? (
              <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {selectedStandaloneGroup.titular.foto ? (
                        <AvatarImage
                          src={selectedStandaloneGroup.titular.foto}
                          alt={selectedStandaloneGroup.titular.nome}
                        />
                      ) : null}
                      <AvatarFallback className="bg-purple-100 text-purple-700">
                        {getInitials(selectedStandaloneGroup.titular.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {selectedStandaloneGroup.titular.nome}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {selectedStandaloneGroup.itens
                          .map((item) => item.aluno.nome)
                          .filter(Boolean)
                          .join(', ') ||
                          (selectedStandaloneGroup.tipo === 'RESPONSAVEL' ? 'Responsável' : 'Aluno')}
                      </div>
                    </div>
                  </div>
                  <Badge variant="info">
                    {selectedStandaloneGroup.itens.length} vínculo(s)
                  </Badge>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 border-t border-slate-200 bg-white px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={requestCloseStandaloneSearch}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!selectedStandaloneGroup || !getGroupCanRenew(selectedStandaloneGroup)}
              className="h-10 min-w-[132px] bg-brand-accent text-white shadow-sm hover:bg-brand-accent/90"
              onClick={() => startStandaloneRenewal(selectedStandaloneGroup)}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={standaloneCloseAlertOpen} onOpenChange={setStandaloneCloseAlertOpen}>
        <AlertDialogContent className="max-w-md rounded-xl border border-slate-200 bg-white">
          <AlertDialogHeader className="space-y-2 text-left">
            <AlertDialogTitle className="text-lg font-medium text-slate-900">
              Sair da rematrícula?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600">
              A busca e a seleção atual serão descartadas. Deseja realmente sair?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              Continuar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-brand-accent text-white hover:bg-brand-accent/90"
              onClick={closeStandaloneSearch}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={campaignFormOpen}
        onOpenChange={(open) => {
          setCampaignFormOpen(open);
          if (!open && !campaignSaving) resetCampaignForm();
        }}
      >
        <DialogContent
          fullScreenMobile
          className="w-full max-w-4xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0 max-md:flex-col md:rounded-2xl"
        >
          <form onSubmit={handleCreateCampaign} className="flex max-h-[88vh] min-h-0 flex-col max-md:max-h-none max-md:flex-1">
            <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
              <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
                {editingCampaign ? 'Editar campanha' : 'Criar campanha'}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600">
                Defina o período futuro, a janela operacional e o público inicial da campanha.
              </DialogDescription>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth bg-slate-50 px-4 py-6 max-md:min-h-0 md:px-8">
              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Identificação</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Nome da campanha</label>
                    <Input
                      value={campaignName}
                      onChange={(event) => setCampaignName(event.target.value)}
                      placeholder="Ex.: Rematrículas 2027"
                      className={modalControlClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={modalLabelClass}>Período de destino</label>
                    <Input
                      value={campaignPeriod}
                      onChange={(event) => setCampaignPeriod(event.target.value)}
                      placeholder="Ex.: Ano letivo 2027"
                      className={modalControlClass}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className={modalLabelClass}>Descrição</label>
                    <textarea
                      value={campaignDescription}
                      onChange={(event) => setCampaignDescription(event.target.value)}
                      rows={3}
                      className={`${modalTextAreaClass} resize-none`}
                      placeholder="Resumo interno da campanha"
                    />
                  </div>
                </div>
              </div>

              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Janela e datas</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Início da campanha</label>
                    <DatePicker
                      value={campaignStartsAt}
                      onChange={(date) => setCampaignStartsAt(formatDateOnly(date))}
                      placeholder="Selecione a data"
                      variant="input"
                      dateFormat="dd/MM/yyyy"
                      className={modalControlClass}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Fim da campanha</label>
                    <DatePicker
                      value={campaignEndsAt}
                      onChange={(date) => setCampaignEndsAt(formatDateOnly(date))}
                      placeholder="Selecione a data"
                      variant="input"
                      dateFormat="dd/MM/yyyy"
                      minDate={campaignStartsAt ? new Date(`${campaignStartsAt}T00:00:00`) : undefined}
                      className={modalControlClass}
                    />
                  </div>
                </div>
              </div>

            </div>

            <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 bg-white px-4 py-4 md:px-8">
              <Button
                type="button"
                variant="outline"
                disabled={campaignSaving}
                className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setCampaignFormOpen(false);
                  resetCampaignForm();
                }}
              >
                Sair
              </Button>
              <Button
                type="submit"
                disabled={campaignSaving || !campaignName.trim() || !campaignPeriod.trim() || !campaignStartsAt}
                className="h-10 min-w-[148px] bg-brand-accent text-white shadow-sm hover:bg-brand-accent/90"
              >
                {campaignSaving
                  ? editingCampaign
                    ? 'Salvando...'
                    : 'Criando...'
                  : editingCampaign
                    ? 'Salvar alterações'
                    : 'Criar campanha'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RematriculaDialog
        open={Boolean(selectedMatricula)}
        contaId={contaId ?? undefined}
        campaigns={campaigns}
        item={selectedMatricula}
        onOpenChange={(open) => {
          if (!open) setSelectedMatricula(null);
        }}
        onCreated={() => {
          toast.custom((t) => (
            <CustomToast
              variant="success"
              title="Rematrícula confirmada"
              description="O próximo ciclo foi preparado sem alterar a matrícula atual."
              onClose={() => toast.dismiss(t)}
            />
          ));
          setSelectedMatricula(null);
          void reload();
        }}
      />

      <RematriculaDialog
        open={Boolean(renewAgainProcess)}
        contaId={contaId ?? undefined}
        campaignId={renewAgainProcess?.campanhaId ?? null}
        targetPeriodId={renewAgainProcess?.targetPeriodId}
        item={buildEditProcessItem(renewAgainProcess)}
        onOpenChange={(open) => {
          if (!open) setRenewAgainProcess(null);
        }}
        onCreated={() => {
          toast.custom((t) => (
            <CustomToast
              variant="success"
              title="Rematrícula preparada"
              description="A nova tentativa ficou como processo atual; a cancelada permanece apenas como histórico."
              onClose={() => toast.dismiss(t)}
            />
          ));
          setRenewAgainProcess(null);
          void reload();
        }}
      />

      <RematriculaDialog
        mode="EDIT_FUTURE"
        open={Boolean(editingProcess)}
        contaId={contaId ?? undefined}
        targetPeriodId={editingProcess?.targetPeriodId}
        item={buildEditProcessItem(editingProcess)}
        process={editingProcess}
        onOpenChange={(open) => {
          if (!open) setEditingProcess(null);
        }}
        onEdited={() => {
          setEditingProcess(null);
          void reload();
        }}
      />

      <RematriculaFamiliarDialog
        open={Boolean(selectedTitular)}
        contaId={contaId ?? undefined}
        campaigns={campaigns}
        titular={selectedTitular ? {
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
