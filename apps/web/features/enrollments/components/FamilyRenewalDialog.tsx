'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useClasses } from '@/features/classes/hooks/use-classes';
import { usePlans } from '@/features/plans/hooks/use-plans';
import { useBundles } from '@/features/bundles/hooks/use-bundles';
import { useResponsaveis } from '@/features/responsibles/hooks/use-responsibles';
import type {
  FormaPagamentoValue,
  RematriculaCampaignSummary,
  RematriculaElegivelItem,
} from '@/features/renewals/services/renewals-service';
import {
  createRematriculaFamiliarRequest,
  createRematriculaRequestId,
  previewRematriculaFamiliarRequest,
  type CreateRematriculaFamiliarInput,
  type RematriculaFamiliarPreviewResponse,
  type RematriculaFamiliarDecision,
  type RematriculaFamiliarModoTurmas,
} from '@/features/renewals/services/renewals-service';
import { useContractTemplates } from '@/features/contracts/hooks/use-contract-templates';
import { toast, CustomToast } from '@/components/ui/toast';
import { InfoCallout } from '@/components/ui/info-callout';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';
import { asaasNotificationPreferencesResultDTOSchema } from '@/features/settings/notifications/asaas/dtos';
import { type CustomerNotificationChannel } from '@/features/settings/notifications/asaas/customer-channel-defaults';
import { cn } from '@/lib/utils';
import { RenewalDiscountSelector } from './RenewalDiscountSelector';
import {
  wizardSoftCheckboxClass,
  wizardSoftFieldInputClass,
  wizardSoftTextareaFieldClass,
} from '@/components/shared/wizard/field-styles';

const formaPagamentoOptions: Array<{
  value: Exclude<FormaPagamentoValue, 'INDEFINIDO'>;
  label: string;
}> = [
  { value: 'BOLETO', label: 'Boleto bancário' },
  { value: 'PIX', label: 'Pix' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
];

const controlClass = wizardSoftFieldInputClass;
const pairedFieldGridClass =
  'grid grid-cols-1 items-start gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)] lg:gap-y-1';
const pairedFieldLabelRowClass = 'flex h-5 items-center gap-1.5';
const pairedFieldControlClass = wizardSoftFieldInputClass;
const sectionClass = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]';
const labelClass = 'text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

type TitularRematricula = {
  id: string;
  tipo: 'RESPONSAVEL' | 'ALUNO';
  nome: string;
  cpf?: string | null;
  foto?: string | null;
};

type ItemConfig = {
  decision: RematriculaFamiliarDecision | null;
  turmaId: string | null;
  comboId: string | null;
  decisionReason?: string | null;
};

interface FamilyRenewalDialogProps {
  open: boolean;
  contaId?: string;
  campaignId?: string | null;
  campaigns?: RematriculaCampaignSummary[];
  targetPeriodId?: string;
  titular: TitularRematricula | null;
  itens: RematriculaElegivelItem[];
  onOpenChange: (_open: boolean) => void;
  onCreated?: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed);
}

function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const normalized = value.includes('T') ? value.slice(0, 10) : value;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatTurmaOption(turma: {
  nome: string;
  horaInicio?: string | null;
  horaFim?: string | null;
  capacidade?: number;
  vagasOcupadas?: number;
}) {
  const horario = turma.horaInicio && turma.horaFim ? `${turma.horaInicio} às ${turma.horaFim}` : '';
  const vagas =
    typeof turma.capacidade === 'number' && typeof turma.vagasOcupadas === 'number'
      ? `${Math.max(0, turma.capacidade - turma.vagasOcupadas)} vaga(s)`
      : '';
  return [turma.nome, horario, vagas].filter(Boolean).join(' • ');
}

const periodicidadeLabels: Record<string, string> = {
  SEMANAL: 'semanal',
  QUINZENAL: 'quinzenal',
  MENSAL: 'mensal',
  TRIMESTRAL: 'trimestral',
  ANUAL: 'anual',
};

export function FamilyRenewalDialog({
  open,
  contaId,
  campaignId,
  campaigns = [],
  targetPeriodId,
  titular,
  itens,
  onOpenChange,
  onCreated,
}: FamilyRenewalDialogProps) {
  // Submissão e estado financeiro/contratual (compartilhados pela família).
  const [submitting, setSubmitting] = useState(false);
  const [closeAlertOpen, setCloseAlertOpen] = useState(false);
  const allowCloseRef = useRef(false);
  const renewalRequestIdRef = useRef<string | null>(null);

  function closeDialog() {
    allowCloseRef.current = true;
    setCloseAlertOpen(false);
    renewalRequestIdRef.current = null;
    onOpenChange(false);
  }

  function requestClose() {
    if (submitting) return;
    setCloseAlertOpen(true);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (allowCloseRef.current) {
      allowCloseRef.current = false;
      onOpenChange(false);
      return;
    }
    requestClose();
  }
  const [dataInicio, setDataInicio] = useState('');
  const [dataFimContrato, setDataFimContrato] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(campaignId ?? null);
  const [formaPagamento, setFormaPagamento] =
    useState<Exclude<FormaPagamentoValue, 'INDEFINIDO'>>('BOLETO');
  const [formaPagamentoTaxa, setFormaPagamentoTaxa] =
    useState<Exclude<FormaPagamentoValue, 'INDEFINIDO'>>('BOLETO');
  const [vencimentoDia, setVencimentoDia] = useState<number>(5);
  const [taxaMatricula, setTaxaMatricula] = useState('');
  const [taxaIsenta, setTaxaIsenta] = useState(false);
  const [taxaJustificativa, setTaxaJustificativa] = useState('');
  const [multaPercentual, setMultaPercentual] = useState('');
  const [jurosMensal, setJurosMensal] = useState('');
  const [descontoAntecipado, setDescontoAntecipado] = useState('');
  const [descontoTipo, setDescontoTipo] = useState<'FIXED' | 'PERCENTAGE'>('PERCENTAGE');
  const [prazoDesconto, setPrazoDesconto] = useState('');
  const [selectedDiscountIds, setSelectedDiscountIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [configs, setConfigs] = useState<Record<string, ItemConfig>>({});
  const [novoResponsavelId, setNovoResponsavelId] = useState<string | null>(null);
  const [contratoModeloId, setContratoModeloId] = useState<string | null>(null);
  const [notificationChannels, setNotificationChannels] = useState<CustomerNotificationChannel[]>(
    [],
  );
  const [notificationChannelsTouched, setNotificationChannelsTouched] = useState(false);

  // Produto financeiro: plano global (modo turmas) ou combo por aluno (modo combo).
  const [modoTurmas, setModoTurmas] = useState<RematriculaFamiliarModoTurmas>('TURMAS');
  const [planoIdGlobal, setPlanoIdGlobal] = useState<string | null>(null);
  const [futureBillingStrategy, setFutureBillingStrategy] = useState<CreateRematriculaFamiliarInput['futureBillingStrategy']>(undefined);
  const [futureAgreementCandidates, setFutureAgreementCandidates] = useState<RematriculaFamiliarPreviewResponse['futureAgreementCandidates']>([]);

  const { items: turmasDisponiveis, loading: turmasLoading } = useClasses({ contaId });
  const { items: planosDisponiveis, loading: planosLoading } = usePlans({ contaId });
  const { items: combosDisponiveis, loading: combosLoading } = useBundles({
    contaId: contaId ?? null,
    status: 'ATIVO',
  });
  const { modelos: contratoModelos, loading: contratoModelosLoading } = useContractTemplates({
    activeOnly: true,
  });
  const { items: responsaveisDisponiveis, loading: responsaveisLoading } = useResponsaveis({
    enabled: open,
  });

  const turmasAtivas = useMemo(
    () => turmasDisponiveis.filter((turma) => turma.status === 'ATIVO'),
    [turmasDisponiveis],
  );
  const planosAtivos = useMemo(
    () => planosDisponiveis.filter((plano) => plano.status === 'ATIVO'),
    [planosDisponiveis],
  );

  const campaignOptions = useMemo(
    () => campaigns.filter((campaign) => campaign.status === 'ACTIVE'),
    [campaigns],
  );
  const selectedCampaign = useMemo(
    () => campaignOptions.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaignOptions, selectedCampaignId],
  );
  const effectiveCampaignId = campaignId ?? selectedCampaignId;
  const effectiveTargetPeriodId =
    targetPeriodId ?? selectedCampaign?.targetPeriodId ?? (dataInicio ? parseDateOnly(dataInicio).getFullYear().toString() : undefined);

  const selectableItems = useMemo(
    () =>
      itens.filter(
        (item) => item.podeRenovar && item.financeiro.rematriculaActionStatus !== 'BLOQUEADA',
      ),
    [itens],
  );

  useEffect(() => {
    if (!open || !contaId) return;
    let cancelled = false;

    const loadNotificationDefaults = async () => {
      try {
        const response = await fetch('/api/configuracoes/notificacoes/asaas', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const raw = await response.json();
        const parsed = asaasNotificationPreferencesResultDTOSchema.parse(raw);
        if (cancelled) return;
        setNotificationChannels(parsed.customerChannelDefaults as CustomerNotificationChannel[]);
        setNotificationChannelsTouched(false);
      } catch {
        if (!cancelled) {
          setNotificationChannels([]);
          setNotificationChannelsTouched(false);
        }
      }
    };

    void loadNotificationDefaults();

    return () => {
      cancelled = true;
    };
  }, [open, contaId]);

  useEffect(() => {
    if (!open) return;
    setDataInicio('');
    setDataFimContrato('');
    setSelectedCampaignId(campaignId ?? null);
    const firstFinanceiro = itens[0]?.financeiro;
    setFormaPagamento(
      firstFinanceiro?.formaPagamento && firstFinanceiro.formaPagamento !== 'INDEFINIDO'
        ? firstFinanceiro.formaPagamento
        : 'BOLETO',
    );
    setFormaPagamentoTaxa(
      firstFinanceiro?.formaPagamentoTaxa && firstFinanceiro.formaPagamentoTaxa !== 'INDEFINIDO'
        ? firstFinanceiro.formaPagamentoTaxa
        : 'BOLETO',
    );
    setVencimentoDia(firstFinanceiro?.vencimentoDia ?? 5);
    setTaxaMatricula(firstFinanceiro?.taxaMatricula != null ? String(firstFinanceiro.taxaMatricula) : '');
    setTaxaIsenta(Boolean(firstFinanceiro?.taxaIsenta));
    setTaxaJustificativa(firstFinanceiro?.taxaJustificativa ?? '');
    setMultaPercentual(firstFinanceiro?.multaPercentual != null ? String(firstFinanceiro.multaPercentual) : '');
    setJurosMensal(firstFinanceiro?.jurosMensal != null ? String(firstFinanceiro.jurosMensal) : '');
    setDescontoAntecipado(firstFinanceiro?.descontoAntecipado != null ? String(firstFinanceiro.descontoAntecipado) : '');
    setDescontoTipo(firstFinanceiro?.descontoTipo === 'FIXED' ? 'FIXED' : 'PERCENTAGE');
    setPrazoDesconto(firstFinanceiro?.prazoDesconto != null ? String(firstFinanceiro.prazoDesconto) : '');
    setOverrideReason('');
    setNovoResponsavelId(null);
    setConfigs(
      Object.fromEntries(
        itens.map((item) => [
          item.id,
          {
            decision:
              item.podeRenovar && item.financeiro.rematriculaActionStatus !== 'BLOQUEADA'
                ? 'DECIDIR_DEPOIS'
                : 'NAO_CONTINUARA',
            turmaId: item.turma?.id ?? null,
            comboId: item.combo?.id ?? null,
            decisionReason: null,
          },
        ]),
      ),
    );
    setContratoModeloId(null);
    setFutureBillingStrategy(undefined);
    setFutureAgreementCandidates([]);
    // Descontos das matrículas atuais não são herdados automaticamente.
    // O usuário precisa selecionar explicitamente um desconto ativo para o novo ciclo.
    setSelectedDiscountIds([]);

    // Inicializa modo a partir do estado atual: se algum tem combo, o padrão é COMBO.
    const firstCombo = itens.find((item) => item.combo?.id)?.combo?.id ?? null;
    const firstPlano = itens.find((item) => item.plano?.id)?.plano?.id ?? null;
    if (firstCombo) {
      setModoTurmas('COMBO');
      setPlanoIdGlobal(null);
    } else {
      setModoTurmas('TURMAS');
      setPlanoIdGlobal(firstPlano);
    }
  }, [campaignId, itens, open]);

  const selectedItems = useMemo(
    () => selectableItems.filter((item) =>
      [
        'REMATRICULAR_AGORA',
        'TRANSFERIR_MODALIDADE',
        'ALTERAR_PAGADOR',
        'REMATRICULAR_SEPARADAMENTE',
      ].includes(configs[item.id]?.decision ?? ''),
    ),
    [configs, selectableItems],
  );

  const decidedItems = useMemo(
    () => itens.filter((item) => Boolean(configs[item.id]?.decision)),
    [configs, itens],
  );

  const needsOverride = selectedItems.some(
    (item) => item.financeiro.rematriculaActionStatus === 'REQUER_OVERRIDE',
  );
  const requiresOverrideReason = selectedItems.some(
    (item) =>
      item.financeiro.rematriculaActionStatus === 'REQUER_OVERRIDE' &&
      item.financeiro.requiresOverrideReason,
  );
  const requiresPayerChange = selectedItems.some(
    (item) => configs[item.id]?.decision === 'ALTERAR_PAGADOR',
  );
  const mixedPayerChange = requiresPayerChange && selectedItems.some(
    (item) => configs[item.id]?.decision !== 'ALTERAR_PAGADOR',
  );

  const planoSelecionado = useMemo(
    () => planosAtivos.find((plano) => plano.id === planoIdGlobal) ?? null,
    [planosAtivos, planoIdGlobal],
  );
  const periodicidadesSelecionadas = useMemo(() => {
    if (modoTurmas === 'TURMAS') {
      return planoSelecionado ? [planoSelecionado.periodicidade] : [];
    }
    return selectedItems
      .filter((item) => configs[item.id]?.decision !== 'REMATRICULAR_SEPARADAMENTE')
      .map((item) => combosDisponiveis.find((combo) => combo.id === configs[item.id]?.comboId)?.periodicidade)
      .filter(Boolean);
  }, [modoTurmas, planoSelecionado, selectedItems, combosDisponiveis, configs]);
  const periodicidadesIncompativeis = new Set(periodicidadesSelecionadas).size > 1;

  const parseDecimal = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const produtoOk =
    modoTurmas === 'COMBO'
      ? selectedItems.every((item) => Boolean(configs[item.id]?.comboId))
      : Boolean(planoIdGlobal);

  const disabled =
    !contaId ||
    !titular ||
    submitting ||
    selectedItems.length === 0 ||
    decidedItems.length !== itens.length ||
    !dataInicio ||
    !dataFimContrato ||
    !produtoOk ||
    periodicidadesIncompativeis ||
    !contratoModeloId ||
    (needsOverride && requiresOverrideReason && !overrideReason.trim()) ||
    (requiresPayerChange && !novoResponsavelId) ||
    mixedPayerChange;

  function updateConfig(id: string, patch: Partial<ItemConfig>) {
    setConfigs((current) => ({
      ...current,
      [id]: {
        decision: current[id]?.decision ?? null,
        turmaId: current[id]?.turmaId ?? null,
        comboId: current[id]?.comboId ?? null,
        decisionReason: current[id]?.decisionReason ?? null,
        ...patch,
      },
    }));
  }

  function handleModoChange(next: RematriculaFamiliarModoTurmas) {
    if (next === modoTurmas) return;
    setModoTurmas(next);
    if (next === 'COMBO') {
      setPlanoIdGlobal(null);
      setConfigs((current) => {
        const nextConfigs = { ...current };
        for (const item of itens) {
          const row = nextConfigs[item.id];
          if (!row) continue;
          nextConfigs[item.id] = {
            ...row,
            comboId: row.comboId ?? item.combo?.id ?? null,
          };
        }
        return nextConfigs;
      });
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contaId || !titular || titular.tipo !== 'RESPONSAVEL' || disabled) return;
    const uiRequestId =
      renewalRequestIdRef.current ??
      (renewalRequestIdRef.current = createRematriculaRequestId());

    const payload: CreateRematriculaFamiliarInput = {
      contaId,
      campaignId: effectiveCampaignId,
      targetPeriodId: effectiveTargetPeriodId,
      responsavelId: titular.id,
      novoResponsavelId: requiresPayerChange ? novoResponsavelId : null,
      modoTurmas,
      planoId: modoTurmas === 'TURMAS' ? planoIdGlobal : null,
      comboId: null,
      itens: itens.map((item) => ({
        matriculaId: item.id,
        decision: configs[item.id]?.decision ?? 'DECIDIR_DEPOIS',
        decisionReason: configs[item.id]?.decisionReason ?? null,
        turmaId:
          modoTurmas === 'COMBO'
            ? null
            : configs[item.id]?.turmaId ?? item.turma?.id ?? null,
        comboId: modoTurmas === 'COMBO' ? configs[item.id]?.comboId ?? null : null,
      })),
      dataInicio: new Date(dataInicio).toISOString(),
      dataFimContrato: new Date(dataFimContrato).toISOString(),
      formaPagamento,
      formaPagamentoTaxa,
      vencimentoDia,
      taxaIsenta,
      descontos: selectedDiscountIds.map((id) => ({ id })),
      descontoTipo,
      notificationChannels: notificationChannelsTouched ? notificationChannels : [],
      notificationChannelsConfigured: notificationChannelsTouched,
      contratoModeloId,
      futureBillingStrategy,
      uiRequestId,
    };

    const taxa = parseDecimal(taxaMatricula);
    payload.taxaMatricula = taxaIsenta
      ? 0
      : typeof taxa === 'number'
        ? Math.max(0, Number(taxa.toFixed(2)))
        : 0;
    if (taxaJustificativa.trim()) payload.taxaJustificativa = taxaJustificativa.trim();

    const multa = parseDecimal(multaPercentual);
    payload.multaPercentual = typeof multa === 'number' ? Math.min(10, Math.max(0, multa)) : 0;
    const juros = parseDecimal(jurosMensal);
    payload.jurosMensal = typeof juros === 'number' ? Math.min(5, Math.max(0, juros)) : 0;
    const desconto = parseDecimal(descontoAntecipado);
    payload.descontoAntecipado =
      typeof desconto === 'number'
        ? Math.min(descontoTipo === 'PERCENTAGE' ? 100 : 99999, Math.max(0, desconto))
        : 0;
    const prazo = parseDecimal(prazoDesconto);
    payload.prazoDesconto =
      typeof prazo === 'number' ? Math.min(30, Math.max(0, Math.trunc(prazo))) : 0;
    if (needsOverride && overrideReason.trim()) payload.overrideReason = overrideReason.trim();

    try {
      setSubmitting(true);
      const preview = await previewRematriculaFamiliarRequest(payload);
      if (preview.blocks.length > 0) {
        throw new Error(preview.blocks[0]?.message ?? 'O preview possui bloqueios.');
      }
      const selectableFutureAgreements = preview.futureAgreementCandidates.filter((candidate) => candidate.canUnify);
      if (selectableFutureAgreements.length > 0 && !futureBillingStrategy) {
        setFutureAgreementCandidates(preview.futureAgreementCandidates);
        return;
      }
      setFutureAgreementCandidates(preview.futureAgreementCandidates);
      const result = await createRematriculaFamiliarRequest({
        ...payload,
        previewId: preview.previewId,
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
      });
      const errors = result.results.filter((item) => item.status === 'error');
      const pendingOrCreated = result.results.filter((item) => item.novaMatriculaId);
      toast.custom((t) => (
        <CustomToast
          variant={errors.length ? 'warning' : 'success'}
          title={errors.length ? 'Próximo ciclo exige atenção' : 'Rematrícula familiar confirmada'}
          description={
            errors.length
              ? `${result.results.length - errors.length} decisão(ões) preparada(s). ${errors.length} item(ns) exigem atenção.`
              : `${pendingOrCreated.length} próximo(s) vínculo(s) preparado(s). A matrícula atual permanece intacta até a data de início.`
          }
          onClose={() => toast.dismiss(t)}
        />
      ));
      onCreated?.();
      closeDialog();
    } catch (error) {
      const message =
        (error as Error).message || 'Não foi possível confirmar o próximo ciclo familiar.';
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível confirmar o próximo ciclo"
          description={message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  if (!titular) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        fullScreenMobile
        data-testid="rematricula-familiar-dialog"
        className="flex h-[min(820px,calc(100dvh-3rem))] w-[calc(100vw-2rem)] max-w-5xl min-h-0 flex-col gap-0 overflow-hidden rounded-[20px] bg-[#f8fafc] p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0"
      >
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0"
        >
          <div className="shrink-0 bg-[#f8fafc] px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5">
            <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 alusa-dark:text-[color:var(--color-text-primary)] md:pr-0">
              Rematrícula familiar
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
              Selecione quais alunos vinculados a {titular.nome} serão rematriculados. O financeiro
              será consolidado em um novo ciclo familiar.
            </DialogDescription>
          </div>

          <div
            className="alusa-wizard-fields flex-1 space-y-4 overflow-y-auto scroll-smooth bg-[#f8fafc] px-4 py-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent alusa-dark:bg-transparent max-md:min-h-0 md:px-6 md:py-5"
            style={{
              scrollbarWidth: 'thin',
              scrollbarGutter: 'stable',
              scrollbarColor: '#d1d5db transparent',
            }}
          >
            {/* Seção 1 — Titular */}
            <div className={sectionClass}>
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  {titular.foto ? <AvatarImage src={titular.foto} alt={titular.nome} /> : null}
                  <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                    {getInitials(titular.nome)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{titular.nome}</div>
                  <div className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    {titular.tipo === 'RESPONSAVEL' ? 'Responsável financeiro' : 'Aluno titular'}
                  </div>
                </div>
                <Badge variant="info" className="ml-auto text-[10px] font-bold uppercase tracking-widest">
                  {selectedItems.length} para rematricular
                </Badge>
              </div>
            </div>

            {!campaignId ? (
              <div className={sectionClass}>
                <div>
                  <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Campanha (Opcional)</span>
                  <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Vincule esta rematrícula familiar a uma campanha para acompanhar a operação.
                  </p>
                </div>
                <Select
                  value={selectedCampaignId ?? 'none'}
                  onValueChange={(value) => setSelectedCampaignId(value === 'none' ? null : value)}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue placeholder="Sem campanha" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem campanha</SelectItem>
                    {campaignOptions.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.nome} ({campaign.targetPeriodId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!selectedCampaign && campaignOptions.length === 0 ? (
                  <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhuma campanha ativa disponível.</p>
                ) : null}
              </div>
            ) : null}

            {/* Seção 2 — Alunos: switch incluir + modo Turma|Combo + turma por aluno */}
            <div className={sectionClass}>
              <div>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Alunos vinculados</span>
                <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                  Defina quais alunos entram no ciclo e o tipo de vínculo acadêmico.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">Tipo de vínculo</p>
                <Tabs
                  value={modoTurmas}
                  onValueChange={(value) => handleModoChange(value as RematriculaFamiliarModoTurmas)}
                >
                  <TabsList className="h-9 rounded-xl bg-slate-100 p-1 alusa-dark:bg-slate-700/70">
                    <TabsTrigger value="TURMAS" className="h-7 rounded-lg px-4 text-xs">
                      Turma individual
                    </TabsTrigger>
                    <TabsTrigger value="COMBO" className="h-7 rounded-lg px-4 text-xs">
                      Combo
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {modoTurmas === 'COMBO' && !combosLoading && combosDisponiveis.length === 0 ? (
                <p className="text-xs text-amber-800">
                  Nenhum combo ativo. Cadastre um combo com valor e periodicidade para usar este modo.
                </p>
              ) : null}

              <div className="space-y-3">
                {itens.map((item) => {
                  const blocked = !item.podeRenovar || item.financeiro.rematriculaActionStatus === 'BLOQUEADA';
                  const config = configs[item.id];
                  const willReenroll = [
                    'REMATRICULAR_AGORA',
                    'TRANSFERIR_MODALIDADE',
                    'ALTERAR_PAGADOR',
                    'REMATRICULAR_SEPARADAMENTE',
                  ].includes(config?.decision ?? '');
                  const turmaSelectDisabled = blocked || !willReenroll || turmasLoading;
                  const comboSelectDisabled =
                    blocked || !willReenroll || combosLoading || modoTurmas !== 'COMBO';
                  const comboEscolhido =
                    config?.comboId != null
                      ? combosDisponiveis.find((c) => c.id === config.comboId)
                      : null;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-slate-700 alusa-dark:bg-slate-800/60 ${blocked ? 'border-slate-200 opacity-70' : 'border-slate-200'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{item.aluno.nome}</span>
                              <span className="text-[11px] leading-snug text-slate-400">
                                Contrato atual: {formatDate(item.dataInicio)} —{' '}
                                {formatDate(item.dataFimContrato)}
                              </span>
                            </div>
                          </div>

                          {modoTurmas === 'COMBO' ? (
                            <div className={pairedFieldGridClass}>
                              <label className={`${labelClass} block h-5 leading-5`}>
                                Combo do novo ciclo
                              </label>
                              <div className={pairedFieldLabelRowClass}>
                                <label className={labelClass} htmlFor={`decision-${item.id}`}>
                                  Decisão
                                </label>
                                <FieldHelpTooltip content="Escolha o destino operacional deste aluno; deixar fora da rematrícula não é mais uma decisão implícita." />
                              </div>
                              <div className="space-y-1.5">
                                <Select
                                  value={config?.comboId ?? 'null'}
                                  onValueChange={(value) =>
                                    updateConfig(item.id, { comboId: value === 'null' ? null : value })
                                  }
                                  disabled={comboSelectDisabled}
                                >
                                  <SelectTrigger className={pairedFieldControlClass}>
                                    <SelectValue placeholder="Selecione o combo" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="null">Selecione o combo</SelectItem>
                                    {combosDisponiveis.map((combo) => (
                                      <SelectItem key={combo.id} value={combo.id}>
                                        {combo.nome}
                                        <span className="ml-2 text-[10px] text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                                          {currencyFormatter.format(combo.valor)} ·{' '}
                                          {periodicidadeLabels[combo.periodicidade] ?? 'mensal'}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {!config?.comboId ? (
                                  <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                                    Selecione um combo para ver as turmas incluídas.
                                  </p>
                                ) : !comboEscolhido?.turmas?.length ? (
                                  <p className="text-xs text-amber-800">
                                    Este combo não possui turmas vinculadas no cadastro.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {comboEscolhido.turmas.map((turma) => (
                                      <span
                                        key={turma.id}
                                        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700"
                                      >
                                        {turma.nome}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <Select
                                value={config?.decision ?? 'DECIDIR_DEPOIS'}
                                onValueChange={(value) =>
                                  updateConfig(item.id, {
                                    decision: value as RematriculaFamiliarDecision,
                                  })
                                }
                                disabled={blocked}
                              >
                                <SelectTrigger id={`decision-${item.id}`} className={pairedFieldControlClass}>
                                  <SelectValue />
                                </SelectTrigger>
                                  <SelectContent>
                                  <SelectItem value="REMATRICULAR_AGORA">Renovar próximo ciclo</SelectItem>
                                  <SelectItem value="NAO_CONTINUARA">Não continuará</SelectItem>
                                  <SelectItem value="DECIDIR_DEPOIS">Decidir depois</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className={pairedFieldGridClass}>
                              <label className={`${labelClass} block h-5 leading-5`}>
                                Turma do novo ciclo
                              </label>
                              <div className={pairedFieldLabelRowClass}>
                                <label className={labelClass} htmlFor={`decision-${item.id}`}>
                                  Decisão
                                </label>
                                <FieldHelpTooltip content="Escolha o destino operacional deste aluno; deixar fora da rematrícula não é mais uma decisão implícita." />
                              </div>
                              <Select
                                value={config?.turmaId ?? 'null'}
                                onValueChange={(value) =>
                                  updateConfig(item.id, { turmaId: value === 'null' ? null : value })
                                }
                                disabled={turmaSelectDisabled}
                              >
                                <SelectTrigger className={pairedFieldControlClass}>
                                  <SelectValue placeholder="Selecione a turma" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="null">Sem turma definida</SelectItem>
                                  {turmasAtivas.map((turma) => {
                                    const lotada = turma.vagasOcupadas >= turma.capacidade;
                                    return (
                                      <SelectItem key={turma.id} value={turma.id} disabled={lotada}>
                                        {formatTurmaOption(turma)}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              <Select
                                value={config?.decision ?? 'DECIDIR_DEPOIS'}
                                onValueChange={(value) =>
                                  updateConfig(item.id, {
                                    decision: value as RematriculaFamiliarDecision,
                                  })
                                }
                                disabled={blocked}
                              >
                                <SelectTrigger id={`decision-${item.id}`} className={pairedFieldControlClass}>
                                  <SelectValue />
                                </SelectTrigger>
                                  <SelectContent>
                                  <SelectItem value="REMATRICULAR_AGORA">Renovar próximo ciclo</SelectItem>
                                  <SelectItem value="NAO_CONTINUARA">Não continuará</SelectItem>
                                  <SelectItem value="DECIDIR_DEPOIS">Decidir depois</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {blocked ? (
                            <InfoCallout variant="warning" size="sm" showIcon={false}>
                              {item.financeiro.actionMessage || 'Este aluno não está elegível para rematrícula.'}
                            </InfoCallout>
                          ) : null}

                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {requiresPayerChange ? (
              <div className={sectionClass}>
                <div>
                  <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Novo responsável financeiro</span>
                  <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    O novo responsável será validado como vínculo do aluno e usado nas cobranças futuras.
                  </p>
                </div>
                <Select
                  value={novoResponsavelId ?? 'null'}
                  onValueChange={(value) => setNovoResponsavelId(value === 'null' ? null : value)}
                  disabled={responsaveisLoading}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue placeholder={responsaveisLoading ? 'Carregando responsáveis...' : 'Selecione o novo responsável'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">Selecione o novo responsável</SelectItem>
                    {responsaveisDisponiveis
                      .filter((responsavel) => responsavel.id !== titular.id)
                      .map((responsavel) => (
                        <SelectItem key={responsavel.id} value={responsavel.id}>
                          {responsavel.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {mixedPayerChange ? (
                  <InfoCallout variant="warning" size="sm" showIcon={false}>
                    Para trocar o pagador com segurança, todos os vínculos renovados nesta confirmação precisam usar essa decisão. Caso contrário, conclua a troca em uma rematrícula separada.
                  </InfoCallout>
                ) : null}
              </div>
            ) : null}

            {/* Seção 3 — Período do contrato */}
            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Período do contrato</span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className={labelClass}>Início</label>
                  <Input type="date" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Fim do contrato</label>
                  <Input type="date" value={dataFimContrato} onChange={(event) => setDataFimContrato(event.target.value)} className={controlClass} />
                </div>
              </div>
            </div>

            {/* Seção 4 — Condições de pagamento */}
            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Condições de pagamento</span>
              {modoTurmas === 'COMBO' ? (
                <>
                  <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Os combos escolhidos em cada aluno definem a cobrança consolidada. Todos devem compartilhar a mesma periodicidade.
                  </p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <label className={labelClass}>Forma de pagamento</label>
                        <FieldHelpTooltip
                          label="Sobre a forma de pagamento"
                          content="Usará a forma de pagamento escolhida para a cobrança familiar."
                        />
                      </div>
                      <Select value={formaPagamento} onValueChange={(value) => setFormaPagamento(value as Exclude<FormaPagamentoValue, 'INDEFINIDO'>)}>
                        <SelectTrigger className={controlClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {formaPagamentoOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <label className={labelClass}>Dia de vencimento</label>
                        <FieldHelpTooltip label="Sobre o dia de vencimento" content="Entre 1 e 28." />
                      </div>
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        value={String(vencimentoDia)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          setVencimentoDia(Number.isFinite(parsed) ? Math.min(28, Math.max(1, parsed)) : 5);
                        }}
                        className={controlClass}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Plano</label>
                      <FieldHelpTooltip
                        label="Sobre o plano"
                        content="O plano determina o valor da mensalidade e a modalidade."
                      />
                    </div>
                    <Select
                      value={planoIdGlobal ?? 'null'}
                      onValueChange={(value) => setPlanoIdGlobal(value === 'null' ? null : value)}
                      disabled={planosLoading}
                    >
                      <SelectTrigger className={controlClass}>
                        {planoSelecionado ? (
                          <div className="flex min-w-0 items-baseline gap-1.5 text-left">
                            <span className="truncate font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{planoSelecionado.nome}</span>
                            <span className="truncate text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                              ({currencyFormatter.format(Number(planoSelecionado.valor))} · {periodicidadeLabels[planoSelecionado.periodicidade] ?? 'mensal'})
                            </span>
                          </div>
                        ) : (
                          <SelectValue placeholder="Selecione o plano" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="null">Selecione o plano</SelectItem>
                        {planosAtivos.map((plano) => (
                          <SelectItem key={plano.id} value={plano.id}>
                            <div className="flex min-w-0 items-baseline gap-1.5 text-left">
                              <span className="truncate font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{plano.nome}</span>
                              <span className="truncate text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                                ({currencyFormatter.format(Number(plano.valor))} · {periodicidadeLabels[plano.periodicidade] ?? 'mensal'})
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Forma de pagamento</label>
                      <FieldHelpTooltip
                        label="Sobre a forma de pagamento"
                        content="Usará a forma de pagamento escolhida para a cobrança familiar."
                      />
                    </div>
                    <Select value={formaPagamento} onValueChange={(value) => setFormaPagamento(value as Exclude<FormaPagamentoValue, 'INDEFINIDO'>)}>
                      <SelectTrigger className={controlClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {formaPagamentoOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Dia de vencimento</label>
                      <FieldHelpTooltip label="Sobre o dia de vencimento" content="Entre 1 e 28." />
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={String(vencimentoDia)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        setVencimentoDia(Number.isFinite(parsed) ? Math.min(28, Math.max(1, parsed)) : 5);
                      }}
                      className={controlClass}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Seção 5 — Contrato */}
            <div className={sectionClass}>
              <div>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Contrato</span>
                <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                  Escolha o modelo que será preparado para cada contrato futuro.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <label className={labelClass}>Modelo de contrato</label>
                  <FieldHelpTooltip content="O contrato futuro será preparado para cada aluno renovado. Se não houver modelo ativo, cadastre um em Contratos > Modelos." />
                </div>
                <Select
                  value={contratoModeloId ?? 'null'}
                  onValueChange={(value) => setContratoModeloId(value === 'null' ? null : value)}
                  disabled={contratoModelosLoading || contratoModelos.length === 0}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue
                      placeholder={
                        contratoModelosLoading ? 'Carregando modelos...' : 'Selecione o modelo'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">Selecione o modelo</SelectItem>
                    {contratoModelos.map((modelo) => (
                      <SelectItem key={modelo.id} value={modelo.id}>
                        {modelo.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {contratoModelos.length === 0 && !contratoModelosLoading ? (
                  <InfoCallout variant="warning" size="sm" showIcon={false}>
                    Nenhum modelo ativo foi encontrado. Cadastre um modelo antes de confirmar a rematrícula.
                  </InfoCallout>
                ) : null}
              </div>
            </div>

            {/* Seção 7 — Taxa de matrícula */}
            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Taxa de matrícula</span>
              <label className="flex cursor-pointer items-start gap-3 rounded-[10px] bg-[#eff3f8] p-3 text-sm text-slate-700 alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)]">
                <Checkbox className={`mt-0.5 ${wizardSoftCheckboxClass}`} checked={taxaIsenta} onCheckedChange={(checked) => setTaxaIsenta(Boolean(checked))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">Isentar taxa nesta rematrícula</span>
                    <FieldHelpTooltip
                      label="Sobre isentar a taxa"
                      content="Nenhuma cobrança será enviada ao responsável."
                    />
                  </div>
                </div>
              </label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className={labelClass}>Valor (R$)</label>
                  <Input type="number" min={0} step={0.01} value={taxaMatricula} disabled={taxaIsenta} onChange={(event) => setTaxaMatricula(event.target.value)} className={`${controlClass} disabled:bg-slate-100 disabled:opacity-60 alusa-dark:disabled:bg-slate-800`} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Forma de pagamento da taxa</label>
                  <Select value={formaPagamentoTaxa} onValueChange={(value) => setFormaPagamentoTaxa(value as Exclude<FormaPagamentoValue, 'INDEFINIDO'>)} disabled={taxaIsenta}>
                    <SelectTrigger className={`${controlClass} disabled:bg-slate-100 disabled:opacity-60 alusa-dark:disabled:bg-slate-800`}><SelectValue /></SelectTrigger>
                    <SelectContent>{formaPagamentoOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Justificativa (opcional)</label>
                <Input value={taxaJustificativa} onChange={(event) => setTaxaJustificativa(event.target.value)} placeholder="Motivo da isenção ou observação..." className={controlClass} />
              </div>
            </div>

            {/* Seção 8 — Juros e multa, igual ao wizard de matrícula */}
            <div className={sectionClass}>
              <div>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Juros e Multa</span>
                <p className="mt-1 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Configure multa, juros e desconto por antecipação. Campos opcionais.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[10px] border border-slate-200 bg-slate-50/80 p-4 alusa-dark:border-slate-700 alusa-dark:bg-slate-800/60">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Multa por atraso</h3>
                  <p className="mb-3 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Aplicada no dia seguinte ao vencimento</p>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={10} step={0.1} value={multaPercentual} onChange={(event) => setMultaPercentual(event.target.value)} placeholder="Ex: 2.0" className={`${controlClass} h-9 w-24`} />
                    <span className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">%</span>
                    <span className="ml-auto text-xs text-gray-400 alusa-dark:text-[color:var(--color-text-secondary)]">máx. 10%</span>
                  </div>
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-slate-50/80 p-4 alusa-dark:border-slate-700 alusa-dark:bg-slate-800/60">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Juros mensais</h3>
                  <p className="mb-3 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Aplicados proporcionalmente aos dias em atraso</p>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={5} step={0.1} value={jurosMensal} onChange={(event) => setJurosMensal(event.target.value)} placeholder="Ex: 1.0" className={`${controlClass} h-9 w-24`} />
                    <span className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">% a.m.</span>
                    <span className="ml-auto text-xs text-gray-400 alusa-dark:text-[color:var(--color-text-secondary)]">máx. 5%</span>
                  </div>
                </div>
                <div className="rounded-[10px] border border-slate-200 bg-slate-50/80 p-4 alusa-dark:border-slate-700 alusa-dark:bg-slate-800/60 sm:col-span-2">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Desconto por antecipação</h3>
                  <p className="mb-3 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Incentivo para pagamento antes do vencimento</p>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Tipo</label>
                      <Tabs value={descontoTipo} onValueChange={(value) => setDescontoTipo(value as 'FIXED' | 'PERCENTAGE')}>
                        <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1 alusa-dark:bg-slate-700/70">
                          <TabsTrigger value="PERCENTAGE" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">%</TabsTrigger>
                          <TabsTrigger value="FIXED" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">R$</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Valor</label>
                      <Input type="number" min={0} max={descontoTipo === 'PERCENTAGE' ? 100 : 99999} step={0.1} value={descontoAntecipado} onChange={(event) => setDescontoAntecipado(event.target.value)} placeholder={descontoTipo === 'PERCENTAGE' ? '5.0' : '10.00'} className={`${controlClass} h-9 w-24`} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Prazo (dias antes)</label>
                      <Input type="number" min={0} max={30} value={prazoDesconto} onChange={(event) => setPrazoDesconto(event.target.value)} placeholder="0" className={`${controlClass} h-9 w-20`} />
                    </div>
                    <span className="pb-2 text-xs text-gray-400 alusa-dark:text-[color:var(--color-text-secondary)]">0 = válido até o vencimento</span>
                  </div>
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Deixe os campos vazios para não aplicar estas configurações.</p>
            </div>

            <div className={sectionClass}>
              <RenewalDiscountSelector contaId={contaId} selectedIds={selectedDiscountIds} onChange={setSelectedDiscountIds} />
            </div>

            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Notificações</span>
              <p className="text-xs text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                Canais para avisos de cobranças futuras ao responsável. Toque para confirmar a
                sugestão da régua global.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                {(
                  [
                    { value: 'WHATSAPP' as const, label: 'WhatsApp' },
                    { value: 'EMAIL' as const, label: 'E-mail' },
                    { value: 'SMS' as const, label: 'SMS' },
                  ] as const
                ).map((option) => {
                  const active = notificationChannels.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setNotificationChannelsTouched(true);
                        setNotificationChannels((prev) =>
                          active
                            ? prev.filter((item) => item !== option.value)
                            : [...prev, option.value],
                        );
                      }}
                      className={cn(
                        'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition',
                        active
                          ? 'border-brand-accent bg-brand-accent text-white'
                          : 'border-slate-200 bg-white text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)] hover:bg-slate-50',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {needsOverride ? (
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Autorização administrativa</span>
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={3}
                  placeholder="Informe o motivo da autorização."
                  className={wizardSoftTextareaFieldClass}
                />
              </div>
            ) : null}

            {periodicidadesIncompativeis ? (
              <InfoCallout variant="warning" size="sm" showIcon={false}>
                A cobrança familiar consolidada exige a mesma periodicidade para todos os vínculos. Ajuste os combos selecionados ou use rematrículas separadas.
              </InfoCallout>
            ) : null}
            {futureAgreementCandidates.length > 0 && !futureBillingStrategy ? (
              <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 alusa-dark:border-violet-900/70 alusa-dark:bg-violet-950/30">
                <div>
                  <p className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">Cobrança futura já encontrada</p>
                  <p className="mt-1 text-xs text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Este responsável já possui uma rematrícula futura para o mesmo período. Escolha se o novo vínculo entra na mesma cobrança ou se terá uma assinatura separada.
                  </p>
                </div>
                {futureAgreementCandidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-[10px] border border-slate-200 bg-white p-3 alusa-dark:border-slate-700 alusa-dark:bg-slate-800/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                          {candidate.studentNames.length > 0 ? candidate.studentNames.join(', ') : 'Outro vínculo'}
                        </p>
                        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                          {currencyFormatter.format(candidate.monthlyTotal)} · {candidate.periodicity ?? 'periodicidade não informada'}
                        </p>
                      </div>
                      <Badge variant={candidate.canUnify ? 'neutral' : 'outline'}>
                        {candidate.canUnify ? 'Unificação disponível' : 'Exige conferência'}
                      </Badge>
                    </div>
                    {candidate.reason ? <p className="mt-2 text-xs text-amber-700 alusa-dark:text-amber-300">{candidate.reason}</p> : null}
                    {candidate.canUnify ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setFutureBillingStrategy({ mode: 'UNIFY_EXISTING', agreementId: candidate.id })}
                        >
                          Unificar nesta cobrança
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setFutureBillingStrategy({ mode: 'SEPARATE', agreementId: null })}
                        >
                          Cobrar separadamente
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 bg-[#f8fafc] px-4 py-3 alusa-dark:bg-[color:var(--color-bg-card)] md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-3">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-h-10 w-full min-w-0 rounded-[10px] border-0 bg-[#eff3f8] px-5 font-normal text-[#303030] shadow-none hover:bg-[#eff3f8] disabled:opacity-60 alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)] md:w-[120px]"
              onClick={requestClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={disabled}
              variant="wizardPrimary"
              className="h-10 min-h-10 w-full min-w-0 rounded-[10px] bg-[#512a82] px-5 font-normal text-white shadow-none hover:bg-[#512a82] disabled:opacity-60 md:w-[190px]"
            >
              {submitting ? 'Processando...' : 'Confirmar próximo ciclo'}
            </Button>
          </div>
        </form>
      </DialogContent>
      </Dialog>

    <AlertDialog open={closeAlertOpen} onOpenChange={setCloseAlertOpen}>
      <AlertDialogContent className="max-w-md rounded-2xl border border-slate-200 bg-[#f8fafc] p-5 alusa-dark:border-slate-700 alusa-dark:bg-[color:var(--color-bg-card)]">
        <AlertDialogHeader className="space-y-1.5 text-left">
          <AlertDialogTitle className="text-base font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
            Sair da rematrícula?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            As informações preenchidas serão descartadas. Deseja realmente sair?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 pt-2">
          <AlertDialogCancel className="border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-100 alusa-dark:border-slate-700 alusa-dark:bg-slate-800 alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-slate-700">
            Continuar
          </AlertDialogCancel>
          <AlertDialogAction className="bg-[#512a82] text-white shadow-none hover:bg-[#45236f]" onClick={closeDialog}>
            Sair
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
