'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
import { useTurmas } from '@/features/cadastro/turmas/hooks/use-turmas';
import { usePlanos } from '@/features/cadastro/planos/hooks/use-planos';
import { useCombos } from '@/features/cadastro/combos/hooks/use-combos';
import type {
  FormaPagamentoValue,
  RematriculaElegivelItem,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';
import {
  createRematriculaFamiliarRequest,
  previewRematriculaFamiliarRequest,
  type CreateRematriculaFamiliarInput,
  type RematriculaFamiliarDecision,
  type RematriculaFamiliarModoTurmas,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';
import { useModelos } from '@/features/contratos/hooks/use-modelos';
import { toast, CustomToast } from '@/components/ui/toast';
import { InfoCallout } from '@/components/ui/info-callout';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { asaasNotificationPreferencesResultDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { type CustomerNotificationChannel } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';
import { cn } from '@/lib/utils';

const formaPagamentoOptions: Array<{
  value: Exclude<FormaPagamentoValue, 'INDEFINIDO'>;
  label: string;
}> = [
  { value: 'BOLETO', label: 'Boleto bancário' },
  { value: 'PIX', label: 'Pix' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
];

const controlClass =
  'flex h-11 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10 md:min-h-0';
const pairedFieldGridClass =
  'grid grid-cols-[minmax(0,1fr)_minmax(180px,220px)] items-start gap-x-4 gap-y-1';
const pairedFieldLabelRowClass = 'flex h-5 items-center gap-1.5';
const pairedFieldControlClass =
  'flex h-10 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';

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

interface RematriculaFamiliarDialogProps {
  open: boolean;
  contaId?: string;
  campaignId?: string | null;
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

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFirstValidStartDate(items: RematriculaElegivelItem[]): Date {
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const contractEnds = items.map((item) => parseDateOnly(item.dataFimContrato).getTime());
  const latestContractEnd = contractEnds.length ? Math.max(...contractEnds) : todayOnly.getTime();
  return new Date(Math.max(todayOnly.getTime(), latestContractEnd));
}

function addOneYear(date: Date): Date {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 1);
  return next;
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

export function RematriculaFamiliarDialog({
  open,
  contaId,
  campaignId,
  targetPeriodId,
  titular,
  itens,
  onOpenChange,
  onCreated,
}: RematriculaFamiliarDialogProps) {
  // Submissão e estado financeiro/contratual (compartilhados pela família).
  const [submitting, setSubmitting] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFimContrato, setDataFimContrato] = useState('');
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
  const [prazoDesconto, setPrazoDesconto] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [configs, setConfigs] = useState<Record<string, ItemConfig>>({});
  const [contratoModeloId, setContratoModeloId] = useState<string | null>(null);
  const [notificationChannels, setNotificationChannels] = useState<CustomerNotificationChannel[]>(
    [],
  );
  const [notificationChannelsTouched, setNotificationChannelsTouched] = useState(false);

  // Produto financeiro: plano global (modo turmas) ou combo por aluno (modo combo).
  const [modoTurmas, setModoTurmas] = useState<RematriculaFamiliarModoTurmas>('TURMAS');
  const [planoIdGlobal, setPlanoIdGlobal] = useState<string | null>(null);

  const { items: turmasDisponiveis, loading: turmasLoading } = useTurmas({ contaId });
  const { items: planosDisponiveis, loading: planosLoading } = usePlanos({ contaId });
  const { items: combosDisponiveis, loading: combosLoading } = useCombos({
    contaId: contaId ?? null,
    status: 'ATIVO',
  });
  const { modelos: contratoModelos, loading: contratoModelosLoading } = useModelos({
    activeOnly: true,
  });

  const turmasAtivas = useMemo(
    () => turmasDisponiveis.filter((turma) => turma.status === 'ATIVO'),
    [turmasDisponiveis],
  );
  const planosAtivos = useMemo(
    () => planosDisponiveis.filter((plano) => plano.status === 'ATIVO'),
    [planosDisponiveis],
  );

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
    const start = getFirstValidStartDate(itens);
    setDataInicio(formatDateInput(start));
    setDataFimContrato(formatDateInput(addOneYear(start)));
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
    setPrazoDesconto(firstFinanceiro?.prazoDesconto != null ? String(firstFinanceiro.prazoDesconto) : '');
    setOverrideReason('');
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
  }, [itens, open]);

  const selectedItems = useMemo(
    () => selectableItems.filter((item) => configs[item.id]?.decision === 'REMATRICULAR_AGORA'),
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

  const descontosHerdados = useMemo(() => {
    const map = new Map<string, { id: string; nome: string }>();
    for (const item of selectedItems) {
      for (const desconto of item.financeiro.descontos) {
        map.set(desconto.id, desconto);
      }
    }
    return Array.from(map.values());
  }, [selectedItems]);

  const planoSelecionado = useMemo(
    () => planosAtivos.find((plano) => plano.id === planoIdGlobal) ?? null,
    [planosAtivos, planoIdGlobal],
  );
  const produtoResumo = useMemo(() => {
    if (modoTurmas === 'COMBO') {
      const combosSel = selectedItems
        .map((item) => {
          const id = configs[item.id]?.comboId;
          if (!id) return null;
          return combosDisponiveis.find((c) => c.id === id) ?? null;
        })
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      if (combosSel.length === 0) return null;
      const nomes = [...new Set(combosSel.map((c) => c.nome))];
      const periodicidades = [...new Set(combosSel.map((c) => c.periodicidade))];
      const primeiro = combosSel[0]!;
      const periodicidade = periodicidadeLabels[primeiro.periodicidade] ?? 'mensal';
      return {
        label: nomes.length === 1 ? nomes[0]! : `${nomes.length} combos distintos`,
        descricao:
          nomes.length === 1 && periodicidades.length === 1
            ? `Combo · ${currencyFormatter.format(primeiro.valor)} (${periodicidade})`
            : periodicidades.length === 1
              ? `Combos distintos · mesma periodicidade (${periodicidadeLabels[periodicidades[0]!] ?? 'mensal'})`
              : 'Atenção: periodicidades diferentes podem impedir a cobrança consolidada.',
      };
    }
    if (!planoSelecionado) return null;
    const periodicidade = periodicidadeLabels[planoSelecionado.periodicidade] ?? 'mensal';
    return {
      label: planoSelecionado.nome,
      descricao: `Plano · ${currencyFormatter.format(Number(planoSelecionado.valor))} (${periodicidade})`,
    };
  }, [modoTurmas, combosDisponiveis, configs, planoSelecionado, selectedItems]);

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
    !contratoModeloId ||
    (needsOverride && requiresOverrideReason && !overrideReason.trim());

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
    const uiRequestId = `${titular.id}:${Date.now()}`;

    const payload: CreateRematriculaFamiliarInput = {
      contaId,
      campaignId,
      targetPeriodId,
      responsavelId: titular.id,
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
      descontos: descontosHerdados.map((desconto) => ({ id: desconto.id })),
      notificationChannels: notificationChannelsTouched ? notificationChannels : [],
      notificationChannelsConfigured: notificationChannelsTouched,
      contratoModeloId,
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
      typeof desconto === 'number' ? Math.min(100, Math.max(0, desconto)) : 0;
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
      const result = await createRematriculaFamiliarRequest({
        ...payload,
        previewId: preview.previewId,
        previewHash: preview.previewHash,
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
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        data-testid="rematricula-familiar-dialog"
        className="flex w-[calc(100vw-2rem)] max-w-[1040px] min-h-0 flex-col gap-0 overflow-hidden bg-slate-50 p-0 max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[calc(100dvh-4rem)] md:rounded-2xl"
      >
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0"
        >
          <div className="relative border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-xl font-semibold text-slate-900 md:pr-0">
              Rematrícula familiar
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              Selecione quais alunos vinculados a {titular.nome} serão rematriculados. O financeiro
              será consolidado em um novo ciclo familiar.
            </DialogDescription>
          </div>

          <div
            className="flex-1 space-y-6 overflow-y-auto scroll-smooth px-4 py-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent max-md:min-h-0 md:px-8 md:py-6"
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
                  <div className="text-sm font-semibold text-slate-900">{titular.nome}</div>
                  <div className="text-xs text-slate-500">
                    {titular.tipo === 'RESPONSAVEL' ? 'Responsável financeiro' : 'Aluno titular'}
                  </div>
                </div>
                <Badge variant="info" className="ml-auto text-[10px] font-bold uppercase tracking-widest">
                  {selectedItems.length} para rematricular
                </Badge>
              </div>
            </div>

            <InfoCallout variant="info" size="sm" showIcon>
              A confirmação prepara matrículas, contratos e cobranças locais. A situação financeira
              muda para concluída apenas após as confirmações automáticas.
            </InfoCallout>

            {/* Seção 2 — Alunos: switch incluir + modo Turma|Combo + turma por aluno */}
            <div className={sectionClass}>
              <div>
                <span className="text-sm font-semibold text-slate-700">Alunos vinculados</span>
                <p className="text-xs text-slate-500">
                  Defina quais alunos entram no ciclo e o tipo de vínculo acadêmico.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-600">Tipo de vínculo</p>
                <Tabs
                  value={modoTurmas}
                  onValueChange={(value) => handleModoChange(value as RematriculaFamiliarModoTurmas)}
                >
                  <TabsList className="h-9 rounded-xl bg-slate-100 p-1">
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
                  const willReenroll = config?.decision === 'REMATRICULAR_AGORA';
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
                      className={`rounded-xl border bg-white p-4 ${blocked ? 'border-slate-200 opacity-70' : 'border-slate-200'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-medium text-slate-900">{item.aluno.nome}</span>
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
                                        <span className="ml-2 text-[10px] text-slate-500">
                                          {currencyFormatter.format(combo.valor)} ·{' '}
                                          {periodicidadeLabels[combo.periodicidade] ?? 'mensal'}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {!config?.comboId ? (
                                  <p className="text-xs text-slate-500">
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

                          {config?.decision === 'NAO_CONTINUARA' || config?.decision === 'DECIDIR_DEPOIS' ? (
                            <InfoCallout variant="info" size="sm" showIcon={false}>
                              {config.decision === 'NAO_CONTINUARA'
                                ? 'Este aluno permanece no ciclo atual e não receberá cobrança do novo ciclo.'
                                : 'Este aluno ficará como pendência operacional e não receberá cobrança nova agora.'}
                            </InfoCallout>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Seção 3 — Produto financeiro do ciclo (plano OU combo), sem card cinza */}
            <div className="space-y-3">
              <div>
                <span className="text-sm font-semibold text-slate-700">
                  {modoTurmas === 'COMBO' ? 'Cobrança com combo' : 'Plano do ciclo familiar'}
                </span>
                <p className="text-xs text-slate-500">
                  {modoTurmas === 'COMBO'
                    ? 'Em cada card de aluno, escolha o combo. O valor e a periodicidade definem a parcela na cobrança consolidada (todos devem compartilhar a mesma periodicidade).'
                    : 'O valor e a periodicidade do plano definem a cobrança recorrente consolidada.'}
                </p>
              </div>

              {modoTurmas === 'COMBO' ? null : (
                <div className="space-y-1">
                  <label className={labelClass}>Plano</label>
                  <Select
                    value={planoIdGlobal ?? 'null'}
                    onValueChange={(value) => setPlanoIdGlobal(value === 'null' ? null : value)}
                    disabled={planosLoading}
                  >
                    <SelectTrigger className={controlClass}>
                      <SelectValue placeholder="Selecione o plano" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="null">Selecione o plano</SelectItem>
                      {planosAtivos.map((plano) => (
                        <SelectItem key={plano.id} value={plano.id}>
                          {plano.nome}
                          <span className="ml-2 text-[10px] text-slate-500">
                            {currencyFormatter.format(Number(plano.valor))} ·{' '}
                            {periodicidadeLabels[plano.periodicidade] ?? 'mensal'}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Seção 4 — Período e cobrança recorrente */}
            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700">Período e cobrança familiar</span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="space-y-1">
                  <label className={labelClass}>Início *</label>
                  <Input type="date" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Fim do contrato *</label>
                  <Input type="date" value={dataFimContrato} onChange={(event) => setDataFimContrato(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Forma de pagamento</label>
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
                  <label className={labelClass}>Vencimento</label>
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
            </div>

            <div className={sectionClass}>
              <div>
                <span className="text-sm font-semibold text-slate-700">Contrato</span>
                <p className="text-xs text-slate-500">
                  Escolha o modelo que será preparado para cada contrato futuro.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <label className={labelClass}>Modelo de contrato *</label>
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

            {/* Seção 5 — Taxa e regras financeiras */}
            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700">Taxa e regras financeiras</span>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Checkbox checked={taxaIsenta} onCheckedChange={setTaxaIsenta} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-800">
                        Isentar taxa de rematrícula
                      </span>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/35"
                              aria-label="Sobre isenção da taxa de rematrícula"
                            >
                              <InformationCircleIcon className="h-4 w-4" aria-hidden />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            Quando marcado, nenhuma taxa avulsa será criada para o grupo.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="space-y-1">
                  <label className={labelClass}>Taxa por aluno (R$)</label>
                  <Input type="number" min={0} step={0.01} value={taxaMatricula} disabled={taxaIsenta} onChange={(event) => setTaxaMatricula(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Pagamento da taxa</label>
                  <Select value={formaPagamentoTaxa} onValueChange={(value) => setFormaPagamentoTaxa(value as Exclude<FormaPagamentoValue, 'INDEFINIDO'>)} disabled={taxaIsenta}>
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
                  <label className={labelClass}>Multa (%)</label>
                  <Input type="number" min={0} max={10} step={0.1} value={multaPercentual} onChange={(event) => setMultaPercentual(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Juros/mês (%)</label>
                  <Input type="number" min={0} max={5} step={0.1} value={jurosMensal} onChange={(event) => setJurosMensal(event.target.value)} className={controlClass} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <label className={labelClass}>Desconto antecipado (%)</label>
                  <Input type="number" min={0} max={100} step={0.5} value={descontoAntecipado} onChange={(event) => setDescontoAntecipado(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Dias antes do vencimento</label>
                  <Input type="number" min={0} max={30} value={prazoDesconto} onChange={(event) => setPrazoDesconto(event.target.value)} className={controlClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Justificativa da taxa</label>
                  <Input value={taxaJustificativa} onChange={(event) => setTaxaJustificativa(event.target.value)} className={controlClass} />
                </div>
              </div>
            </div>

            <div className={sectionClass}>
              <span className="text-sm font-semibold text-slate-700">Notificações</span>
              <p className="text-xs text-slate-600">
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
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
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
                <span className="text-sm font-semibold text-slate-700">Autorização administrativa</span>
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={3}
                  placeholder="Informe o motivo da autorização."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30"
                />
              </div>
            ) : null}

            <p className="text-sm text-slate-600">
              <strong className="text-slate-800">Resumo:</strong> {selectedItems.length} aluno(s) terão o próximo ciclo preparado
              {modoTurmas === 'COMBO' ? (
                <>
                  {' '}
                  com{' '}
                  {produtoResumo ? (
                    <>
                      <span className="font-medium text-slate-900">{produtoResumo.label}</span>
                      {produtoResumo.descricao ? (
                        <span className="text-slate-600"> — {produtoResumo.descricao}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="font-medium text-slate-900">—</span>
                  )}
                </>
              ) : (
                <>
                  {' '}
                  com o plano <span className="font-medium text-slate-900">{produtoResumo?.label ?? '—'}</span>
                </>
              )}
              . Cobrança familiar consolidada para {titular.nome}.
            </p>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-8 md:py-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 w-full min-w-0 border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={disabled}
              className="h-11 min-h-11 w-full min-w-0 bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[190px]"
            >
              {submitting ? 'Processando...' : 'Confirmar próximo ciclo'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
