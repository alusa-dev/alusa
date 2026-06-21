'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { Button } from '@/components/ui/button';
import useCurrentUser from '@/hooks/use-current-user';
import { useRematriculas } from './hooks/use-rematriculas';
import type { RematriculaElegivelItem, StatusContrato } from './services/rematriculas-service';
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
import { CalendarDays, Edit3, MoreVertical, Search, Trash2 } from 'lucide-react';
import {
  cancelRematriculaProcessRequest,
  createRematriculaCommunicationRequest,
  createRematriculaCampaignRequest,
  editRematriculaFutureLinkRequest,
  grantRematriculaExceptionRequest,
  resolveRematriculaPendingRequest,
  updateRematriculaCampaignRequest,
  type RematriculaCampaignSummary,
  type RematriculaProcessSummary,
} from './services/rematriculas-service';

type QuickFilter = 'CAMPANHAS' | 'TODOS';
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

function getDiasBadgeVariant(diasRestantes: number): BadgeVariant {
  if (diasRestantes < 0) return 'destructive';
  if (diasRestantes <= 15) return 'warning';
  if (diasRestantes <= 45) return 'info';
  return 'default';
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

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Primeiro nome(s) + sobrenome essencial para exibição compacta (ex.: Lara Bianca de Alencar → Lara Bianca). */
function shortStudentDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  const lower = parts.map((w) => w.toLowerCase());
  const particleIdx = lower.findIndex((w) => NAME_PARTICLES.has(w));

  if (particleIdx === -1) {
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  const given = parts.slice(0, particleIdx).join(' ');
  const afterParticle = parts[particleIdx + 1];

  if (particleIdx === 1) {
    return afterParticle ? `${parts[0]} ${afterParticle}` : parts[0];
  }

  return given || parts[0];
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

function campaignStatusLabel(status: RematriculaCampaignSummary['status']) {
  const labels: Record<RematriculaCampaignSummary['status'], string> = {
    DRAFT: 'Rascunho',
    SCHEDULED: 'Agendada',
    ACTIVE: 'Ativa',
    PAUSED: 'Pausada',
    CLOSED: 'Fechada',
    ARCHIVED: 'Arquivada',
  };
  return labels[status] ?? status;
}

function getCampaignStatusClasses(status: RematriculaCampaignSummary['status']) {
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (status === 'PAUSED' || status === 'SCHEDULED') return 'bg-amber-100 text-amber-700';
  if (status === 'DRAFT') return 'bg-slate-100 text-slate-700';
  if (status === 'CLOSED') return 'bg-indigo-100 text-indigo-700';
  return 'bg-zinc-100 text-zinc-600';
}

function getCampaignAccentClasses(index: number) {
  const accents = [
    {
      icon: 'bg-violet-100 text-violet-700',
      bar: 'bg-violet-600',
    },
    {
      icon: 'bg-orange-100 text-orange-600',
      bar: 'bg-orange-500',
    },
    {
      icon: 'bg-slate-100 text-slate-600',
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

function getGroupActionStatus(group: RematriculaTitularGroup) {
  const statuses = group.itens.map((item) => item.financeiro.rematriculaActionStatus);
  if (statuses.includes('BLOQUEADA')) return 'BLOQUEADA';
  if (statuses.includes('REQUER_OVERRIDE')) return 'REQUER_OVERRIDE';
  if (statuses.includes('LIBERADA_COM_AVISO')) return 'LIBERADA_COM_AVISO';
  return 'LIBERADA';
}

function getGroupDiasRestantes(group: RematriculaTitularGroup) {
  return Math.min(...group.itens.map((item) => item.diasRestantes));
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

export default function RematriculasFeature() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [search, setSearch] = useState('');
  const [diasAntecedencia, setDiasAntecedencia] = useState(DEFAULT_RENEWAL_LOOKAHEAD_DAYS);
  const [statusContrato, setStatusContrato] = useState<StatusContrato | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('CAMPANHAS');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<'TODOS' | RematriculaCampaignSummary['status']>('TODOS');
  const [campaignPeriodFilter, setCampaignPeriodFilter] = useState('TODOS');
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [selectedTitular, setSelectedTitular] = useState<RematriculaTitularGroup | null>(null);
  const [campaignFormOpen, setCampaignFormOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [campaignPeriod, setCampaignPeriod] = useState(String(new Date().getFullYear() + 1));
  const [campaignStartsAt, setCampaignStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [campaignEndsAt, setCampaignEndsAt] = useState('');
  const [campaignEditableUntil, setCampaignEditableUntil] = useState('');
  const [campaignFirstDueDateRule, setCampaignFirstDueDateRule] = useState('AFTER_EFFECTIVE_AT');
  const [campaignAudienceType, setCampaignAudienceType] = useState('ALL_ACTIVE_ENROLLMENTS');
  const [campaignFamilyRule, setCampaignFamilyRule] = useState('ALLOW_PARTIAL');
  const [campaignFeePolicy, setCampaignFeePolicy] = useState('EXEMPT');
  const [campaignExceptionPolicy, setCampaignExceptionPolicy] = useState('ALLOW_WITH_JUSTIFICATION');
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<RematriculaCampaignSummary | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<RematriculaProcessSummary | null>(null);

  const modalControlClass =
    'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
  const modalTextAreaClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
  const modalSectionClass =
    'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
  const modalLabelClass = 'text-xs font-medium text-slate-600';

  const { items, loading, reload, campaigns, processes } = useRematriculas({
    contaId,
    diasAntecedencia,
    statusContrato,
    search: search || undefined,
  });

  const quickFilterOptions: Array<{ label: string; value: QuickFilter }> = [
    { label: 'Campanhas', value: 'CAMPANHAS' },
    { label: 'Todos os processos', value: 'TODOS' },
  ];

  const groupedItems = useMemo(() => buildTitularGroups(items), [items]);

  const filteredGroups = useMemo(() => {
    return groupedItems;
  }, [groupedItems, quickFilter]);

  const filteredProcesses = useMemo(() => {
    return processes;
  }, [processes, quickFilter]);

  const campaignPeriodOptions = useMemo(() => {
    return Array.from(new Set(campaigns.map((campaign) => campaign.targetPeriodId).filter(Boolean))).sort();
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
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
  }, [campaignPeriodFilter, campaignStatusFilter, campaigns, search]);

  function resetCampaignForm() {
    setCampaignName('');
    setCampaignDescription('');
    setCampaignPeriod(String(new Date().getFullYear() + 1));
    setCampaignStartsAt(new Date().toISOString().slice(0, 10));
    setCampaignEndsAt('');
    setCampaignEditableUntil('');
    setCampaignFirstDueDateRule('AFTER_EFFECTIVE_AT');
    setCampaignAudienceType('ALL_ACTIVE_ENROLLMENTS');
    setDiasAntecedencia(DEFAULT_RENEWAL_LOOKAHEAD_DAYS);
    setCampaignFamilyRule('ALLOW_PARTIAL');
    setCampaignFeePolicy('EXEMPT');
    setCampaignExceptionPolicy('ALLOW_WITH_JUSTIFICATION');
    setEditingCampaign(null);
  }

  function toDateInputValue(value: string | null | undefined) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatDateOnly(date);
  }

  function openEditCampaignModal(campaign: RematriculaCampaignSummary) {
    const rules = campaign.rules ?? {};
    const audienceDefinition = campaign.audienceDefinition ?? {};
    const enrollmentFeePolicy =
      rules.enrollmentFeePolicy && typeof rules.enrollmentFeePolicy === 'object'
        ? (rules.enrollmentFeePolicy as Record<string, unknown>)
        : {};
    const exceptions =
      rules.exceptions && typeof rules.exceptions === 'object'
        ? (rules.exceptions as Record<string, unknown>)
        : {};

    setEditingCampaign(campaign);
    setCampaignName(campaign.nome);
    setCampaignDescription(campaign.descricao ?? '');
    setCampaignPeriod(campaign.targetPeriodId);
    setCampaignStartsAt(toDateInputValue(campaign.campaignStartsAt));
    setCampaignEndsAt(toDateInputValue(campaign.campaignEndsAt));
    setCampaignEditableUntil(typeof rules.editableUntil === 'string' ? rules.editableUntil : '');
    setCampaignFirstDueDateRule(
      typeof rules.firstDueDateRule === 'string' ? rules.firstDueDateRule : 'AFTER_EFFECTIVE_AT',
    );
    setCampaignAudienceType(
      typeof audienceDefinition.type === 'string'
        ? audienceDefinition.type
        : 'ALL_ACTIVE_ENROLLMENTS',
    );
    setDiasAntecedencia(
      typeof audienceDefinition.diasAntecedencia === 'number'
        ? audienceDefinition.diasAntecedencia
        : DEFAULT_RENEWAL_LOOKAHEAD_DAYS,
    );
    setCampaignFamilyRule(rules.allowPartialFamilyRenewal === false ? 'REQUIRE_ALL' : 'ALLOW_PARTIAL');
    setCampaignFeePolicy(
      typeof enrollmentFeePolicy.chargeMoment === 'string'
        ? enrollmentFeePolicy.chargeMoment
        : 'EXEMPT',
    );
    setCampaignExceptionPolicy(exceptions.allowed === false ? 'BLOCK' : 'ALLOW_WITH_JUSTIFICATION');
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
          type: campaignAudienceType,
          diasAntecedencia,
          filters: {
            academicStatus: ['ATIVO'],
            financialStatus: ['ADIMPLENTE', 'COM_PENDENCIA_PERMITIDA'],
          },
        },
        rules: {
          requireAllCurrentItemsDecision: true,
          allowPartialFamilyRenewal: campaignFamilyRule === 'ALLOW_PARTIAL',
          minimumFamilyParticipants: campaignFamilyRule === 'REQUIRE_ALL' ? 'ALL_CURRENT_ITEMS' : 1,
          editableUntil: campaignEditableUntil || null,
          firstDueDateRule: campaignFirstDueDateRule,
          exceptions: {
            allowed: campaignExceptionPolicy === 'ALLOW_WITH_JUSTIFICATION',
            requiresJustification: campaignExceptionPolicy === 'ALLOW_WITH_JUSTIFICATION',
          },
          enrollmentFeePolicy: {
            chargeMoment: campaignFeePolicy,
            feeUnit: campaignFeePolicy === 'EXEMPT' ? 'NO_FEE' : 'PER_STUDENT',
            purpose: 'ADMINISTRATIVE_FEE',
          },
          closeBehavior: 'KEEP_DRAFTS_AS_PENDING',
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
              : 'A campanha foi criada como rascunho.'
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
      await updateRematriculaCampaignRequest(campaign.id, { status: 'ARCHIVED' });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Campanha excluída"
          description="A campanha foi arquivada e preservada no histórico."
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

  async function handleCancelProcess(processId: string) {
    const reason = window.prompt('Informe o motivo do cancelamento do próximo ciclo:');
    if (!reason?.trim()) return;
    try {
      await cancelRematriculaProcessRequest(processId, reason.trim());
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Próximo ciclo cancelado"
          description="A matrícula atual foi preservada."
          onClose={() => toast.dismiss(t)}
        />
      ));
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
    }
  }

  async function handleEditFutureLink(process: RematriculaProcessSummary) {
    const targetClassId = window.prompt('ID da turma futura:', process.itens[0]?.targetClassId ?? '');
    if (targetClassId == null) return;
    const targetPlanId = window.prompt('ID do plano futuro:', process.itens[0]?.targetPlanId ?? '');
    if (targetPlanId == null) return;
    const reason = window.prompt('Justificativa da alteração:');
    if (!reason?.trim()) return;

    try {
      await editRematriculaFutureLinkRequest(process.id, {
        targetClassId: targetClassId.trim() || null,
        targetPlanId: targetPlanId.trim() || null,
        reason: reason.trim(),
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Próximo ciclo atualizado"
          description="A alteração foi versionada e auditada."
          onClose={() => toast.dismiss(t)}
        />
      ));
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível editar"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
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

  async function handleGrantException(process: RematriculaProcessSummary) {
    const rule = window.prompt('Regra ignorada ou flexibilizada:');
    if (!rule?.trim()) return;
    const impact = window.prompt('Impacto da exceção:');
    if (!impact?.trim()) return;
    const justification = window.prompt('Justificativa da exceção:');
    if (!justification?.trim()) return;

    try {
      await grantRematriculaExceptionRequest(process.id, {
        permission: 'renewal.exception.grant',
        rule: rule.trim(),
        impact: impact.trim(),
        justification: justification.trim(),
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Exceção registrada"
          description="A exceção ficou vinculada ao processo."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setSelectedProcess(null);
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível registrar exceção"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  async function handleCreateCommunication(process: RematriculaProcessSummary) {
    const message = window.prompt('Mensagem para registrar na comunicação do processo:');
    if (!message?.trim()) return;

    try {
      await createRematriculaCommunicationRequest(process.id, {
        channel: 'PORTAL',
        audience: process.holderType === 'RESPONSIBLE' ? 'RESPONSAVEL' : 'ALUNO',
        subject: 'Atualização de rematrícula',
        message: message.trim(),
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Comunicação registrada"
          description="A mensagem ficou no histórico do processo."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setSelectedProcess(null);
      void reload();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível registrar comunicação"
          description={(error as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  }

  const getFinanceiroBadge = (group: RematriculaTitularGroup) => {
    const status = getGroupActionStatus(group);
    if (status === 'BLOQUEADA') {
      return <Badge variant="destructive">Bloqueada</Badge>;
    }
    if (status === 'REQUER_OVERRIDE') {
      return <Badge variant="warning">Override</Badge>;
    }
    if (status === 'LIBERADA_COM_AVISO') {
      return <Badge variant="info">Aviso</Badge>;
    }
    return <Badge variant="default">Liberada</Badge>;
  };

  const columns: DataTableColumn<RematriculaTitularGroup>[] = [
    {
      id: 'titular',
      header: 'Titular',
      width: 'w-1/4',
      align: 'left',
      render: (row) => {
        const initials = getInitials(row.titular.nome);
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10">
              {row.titular.foto ? (
                <AvatarImage src={row.titular.foto} alt={row.titular.nome} />
              ) : null}
              <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-normal text-gray-900 text-[13px] truncate">
                {row.titular.nome}
              </div>
              <div className="text-xs text-gray-500">
                {row.tipo === 'RESPONSAVEL' ? 'Responsável financeiro' : 'Aluno titular'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'alunos',
      header: 'Alunos',
      width: 'w-1/4',
      align: 'left',
      render: (row) => {
        const compactNames = row.itens.map((item) =>
          shortStudentDisplayName(item.aluno.nome ?? ''),
        );
        const fullNames = row.itens.map((item) => item.aluno.nome ?? '').filter(Boolean);
        return (
          <div className="truncate text-sm text-gray-900" title={fullNames.join(' · ')}>
            {joinNamesPortuguese(compactNames)}
          </div>
        );
      },
    },
    {
      id: 'contrato',
      header: 'Contrato',
      width: 'w-1/6',
      align: 'center',
      render: (row) => {
        const dias = getGroupDiasRestantes(row);
        return (
          <Badge variant={getDiasBadgeVariant(dias)}>
            {dias < 0 ? 'Expirado' : `${dias} dia${dias === 1 ? '' : 's'}`}
          </Badge>
        );
      },
    },
    {
      id: 'status',
      header: 'Operação',
      width: 'w-1/6',
      align: 'center',
      render: (row) => (
        <div className="flex items-center justify-center">{getFinanceiroBadge(row)}</div>
      ),
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-1/6',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            variant={getGroupCanRenew(row) ? 'default' : 'outline'}
            size="sm"
            className={getGroupCanRenew(row) ? 'bg-brand-accent text-white' : 'text-xs'}
            disabled={!getGroupCanRenew(row)}
            onClick={() => {
              if (!getGroupCanRenew(row)) {
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
              if (row.tipo === 'RESPONSAVEL') {
                setSelectedTitular(row);
              } else {
                setSelectedMatricula(row.itens[0] ?? null);
              }
            }}
          >
            Iniciar
          </Button>
        </div>
      ),
    },
  ];

  const campaignColumns: DataTableColumn<RematriculaCampaignSummary>[] = [
    {
      id: 'campanha',
      header: 'Campanha',
      width: 'min-w-0 lg:w-[33%]',
      align: 'left',
      noWrap: false,
      render: (campaign) => {
        const index = filteredCampaigns.findIndex((item) => item.id === campaign.id);
        const accent = getCampaignAccentClasses(index < 0 ? 0 : index);
        const progress = getCampaignProgress(campaign, processes);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent.icon}`}>
              <CalendarDays className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-normal text-gray-900">
                {campaign.nome}
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-snug text-gray-500">
                {progress.total} incluídos · {progress.waiting} aguardando início · {progress.attention} requerem atenção
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'periodo',
      header: 'Período de destino',
      width: 'lg:w-[16%]',
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
      width: 'lg:w-[10%]',
      align: 'center',
      render: (campaign) => (
        <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-medium ${getCampaignStatusClasses(campaign.status)}`}>
          {campaignStatusLabel(campaign.status)}
        </span>
      ),
    },
    {
      id: 'progresso',
      header: 'Progresso',
      width: 'lg:w-[13%]',
      align: 'left',
      render: (campaign) => {
        const index = filteredCampaigns.findIndex((item) => item.id === campaign.id);
        const accent = getCampaignAccentClasses(index < 0 ? 0 : index);
        const progress = getCampaignProgress(campaign, processes);
        return (
          <div className="min-w-0">
            <div className="mb-1.5 text-[13px] font-medium leading-none text-gray-700">
              {progress.confirmed} / {progress.total}
            </div>
            <div className="h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full ${accent.bar}`}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        );
      },
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
  const showAvailable = quickFilter === 'TODOS';

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
              onClick={() => {
                setQuickFilter('TODOS');
              }}
            >
              Rematrícula avulsa
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
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
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por nome da campanha"
                    className="h-10 w-full rounded-lg border-slate-200 pl-10 shadow-none lg:w-[360px] xl:w-[420px]"
                  />
                </label>
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

          {showAvailable ? (
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por responsável ou aluno"
                  className="h-10 w-full rounded-lg border-slate-200 pl-10 shadow-none lg:w-[360px] xl:w-[420px]"
                />
              </label>
              <div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:items-center lg:justify-end">
                <Select
                  value={statusContrato ?? 'TODOS'}
                  onValueChange={(value) =>
                    setStatusContrato(value === 'TODOS' ? undefined : (value as StatusContrato))
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:min-w-[170px]">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent align="end" className="text-[13px]">
                    <SelectItem value="TODOS">Todos os status</SelectItem>
                    <SelectItem value="ATIVO">Contrato ativo</SelectItem>
                    <SelectItem value="AGUARDANDO_ASSINATURA">Aguardando assinatura</SelectItem>
                    <SelectItem value="EXPIRADO">Expirado</SelectItem>
                    <SelectItem value="CANCELADO">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700">
                  <span>Dias</span>
                  <input
                    type="number"
                    min={15}
                    max={365}
                    value={diasAntecedencia}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setDiasAntecedencia(
                        Number.isFinite(parsed)
                          ? Math.min(365, Math.max(15, parsed))
                          : DEFAULT_RENEWAL_LOOKAHEAD_DAYS,
                      );
                    }}
                    className="w-16 border-0 bg-transparent text-right outline-none"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {selectedProcess ? (
            <div className="rounded-xl border bg-white px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Processo {selectedProcess.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {selectedProcess.origin === 'CAMPAIGN' ? selectedProcess.campanha?.nome ?? 'Campanha' : 'Avulsa'} · {getProcessLabel(selectedProcess.status)}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCreateCommunication(selectedProcess)}
                  >
                    Comunicação
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleGrantException(selectedProcess)}
                  >
                    Exceção
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setSelectedProcess(null)}>
                    Fechar
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 pt-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Vínculo atual</div>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    {selectedProcess.itens.map((item) => (
                      <div key={item.id}>
                        <span className="font-medium text-slate-900">{item.aluno?.nome ?? item.matriculaOrigemId}</span>
                        <span className="text-slate-500">
                          {' '}· {item.turmaAtual?.nome ?? item.comboAtual?.nome ?? 'Sem turma atual'} · decisão {item.decision}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Próximo ciclo</div>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <div>Início: {formatDate(selectedProcess.effectiveAt)}</div>
                    <div>Reserva: {selectedProcess.reservas[0]?.status ?? 'NOT_RESERVED'}</div>
                    <div>Contrato futuro: {selectedProcess.contratos[0]?.status ?? 'DRAFT'}</div>
                    <div>Financeiro futuro: {selectedProcess.financeiros[0]?.status ?? 'NOT_PREPARED'}</div>
                  </div>
                </div>
              </div>
              {selectedProcess.pendencias.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Pendências
                    </div>
                    <Badge variant="warning">{selectedProcess.pendencias.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {selectedProcess.pendencias.map((pending) => (
                      <div
                        key={pending.id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-amber-950">{pending.title}</div>
                          <div className="text-amber-900">{pending.message}</div>
                          <div className="mt-1 text-xs text-amber-700">
                            {pending.code} · {pending.status}
                          </div>
                        </div>
                        {['OPEN', 'IN_PROGRESS'].includes(pending.status) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handleResolvePending(pending.id)}
                          >
                            Resolver
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Exceções
                  </div>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {selectedProcess.excecoes.length === 0 ? (
                      <div className="text-slate-500">Nenhuma exceção registrada.</div>
                    ) : (
                      selectedProcess.excecoes.map((exception) => (
                        <div key={exception.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="font-medium text-slate-900">{exception.rule}</div>
                          <div>{exception.justification}</div>
                          <div className="mt-1 text-xs text-slate-500">{exception.status}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Comunicação
                  </div>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {selectedProcess.comunicacoes.length === 0 ? (
                      <div className="text-slate-500">Nenhuma comunicação registrada.</div>
                    ) : (
                      selectedProcess.comunicacoes.map((communication) => (
                        <div key={communication.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="font-medium text-slate-900">
                            {communication.subject ?? communication.channel}
                          </div>
                          <div className="text-xs text-slate-500">
                            {communication.channel} · {communication.status} · {formatDate(communication.createdAt)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {showProcesses && filteredProcesses.length > 0 ? (
            <div className="overflow-hidden rounded-xl border bg-white">
              <div className="grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr_auto] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                <span>Processo</span>
                <span>Status</span>
                <span>Início</span>
                <span>Financeiro futuro</span>
                <span className="text-right">Ações</span>
              </div>
              {filteredProcesses.map((process) => (
                <div
                  key={process.id}
                  className="grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr_auto] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">
                      {process.itens.map((item) => item.aluno?.nome).filter(Boolean).join(', ') || process.id}
                    </div>
                    <div className="text-xs text-slate-500">
                      {process.origin === 'CAMPAIGN' ? process.campanha?.nome ?? 'Campanha' : 'Avulsa'} · {process.targetPeriodId}
                    </div>
                  </div>
                  <Badge variant={getProcessBadgeVariant(process.status)}>{getProcessLabel(process.status)}</Badge>
                  <span>{formatDate(process.effectiveAt)}</span>
                  <span>
                    {process.financeiros[0]?.status ?? 'NOT_PREPARED'} · R$ {process.monthlyTotal.toFixed(2)}
                  </span>
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelectedProcess(process)}>
                      Ver
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(process.status)}
                      onClick={() => void handleEditFutureLink(process)}
                    >
                      Editar próximo ciclo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(process.status)}
                      onClick={() => void handleCancelProcess(process.id)}
                    >
                      Cancelar futuro
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {showAvailable ? (
            <div className="bg-white rounded-xl border overflow-hidden px-0 py-0">
              <DataTable
                aria-label="Tabela de rematrículas elegíveis"
                columns={columns}
                data={filteredGroups}
                rowKey={(row) => row.id}
                loading={loading}
                emptyMessage={
                  <div className="px-6 py-12 text-center text-sm text-gray-500">
                    {loading
                      ? 'Carregando rematrículas...'
                      : 'Nenhuma matrícula elegível encontrada para os filtros atuais'}
                  </div>
                }
              />
            </div>
          ) : null}
        </div>
      </section>

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
                Defina o período futuro, a janela operacional, os candidatos iniciais e as regras da campanha.
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Editável até</label>
                    <DatePicker
                      value={campaignEditableUntil}
                      onChange={(date) => setCampaignEditableUntil(formatDateOnly(date))}
                      placeholder="Selecione a data"
                      variant="input"
                      dateFormat="dd/MM/yyyy"
                      className={modalControlClass}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Primeira cobrança</label>
                    <Select
                      value={campaignFirstDueDateRule}
                      onValueChange={setCampaignFirstDueDateRule}
                    >
                      <SelectTrigger className={modalControlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AFTER_EFFECTIVE_AT">Após início do ciclo</SelectItem>
                        <SelectItem value="SAME_DAY_OF_CURRENT_CONTRACT">Mesmo dia do contrato atual</SelectItem>
                        <SelectItem value="MANUAL_ON_PREVIEW">Definir no preview</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Candidatos iniciais</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1 md:col-span-2">
                    <label className={modalLabelClass}>Segmentação</label>
                    <Select value={campaignAudienceType} onValueChange={setCampaignAudienceType}>
                      <SelectTrigger className={modalControlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL_ACTIVE_ENROLLMENTS">Matrículas ativas</SelectItem>
                        <SelectItem value="CONTRACT_END_WINDOW">Contratos na janela</SelectItem>
                        <SelectItem value="CURRENT_CLASSES">Turmas atuais</SelectItem>
                        <SelectItem value="CURRENT_PLANS_OR_COMBOS">Planos ou combos atuais</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className={modalLabelClass}>Antecedência</label>
                    <Input
                      type="number"
                      min={15}
                      max={365}
                      value={diasAntecedencia}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        setDiasAntecedencia(
                          Number.isFinite(parsed)
                            ? Math.min(365, Math.max(15, parsed))
                            : DEFAULT_RENEWAL_LOOKAHEAD_DAYS,
                        );
                      }}
                      className={modalControlClass}
                    />
                  </div>
                </div>
              </div>

              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Regras iniciais</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className={modalLabelClass}>Família</label>
                    <Select value={campaignFamilyRule} onValueChange={setCampaignFamilyRule}>
                      <SelectTrigger className={modalControlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALLOW_PARTIAL">Permitir renovação parcial</SelectItem>
                        <SelectItem value="REQUIRE_ALL">Exigir todos os vínculos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className={modalLabelClass}>Taxa de rematrícula</label>
                    <Select value={campaignFeePolicy} onValueChange={setCampaignFeePolicy}>
                      <SelectTrigger className={modalControlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EXEMPT">Isenta</SelectItem>
                        <SelectItem value="CHARGE_ON_CONFIRMATION">Cobrar na confirmação</SelectItem>
                        <SelectItem value="CHARGE_ON_START">Cobrar no início</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className={modalLabelClass}>Exceções administrativas</label>
                    <Select
                      value={campaignExceptionPolicy}
                      onValueChange={setCampaignExceptionPolicy}
                    >
                      <SelectTrigger className={modalControlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALLOW_WITH_JUSTIFICATION">Permitir com justificativa</SelectItem>
                        <SelectItem value="BLOCK">Bloquear exceções</SelectItem>
                      </SelectContent>
                    </Select>
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

      <RematriculaFamiliarDialog
        open={Boolean(selectedTitular)}
        contaId={contaId ?? undefined}
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
