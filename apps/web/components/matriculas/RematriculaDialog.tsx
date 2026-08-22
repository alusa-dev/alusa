'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTurmas } from '@/features/cadastro/turmas/hooks/use-turmas';
import { usePlanos } from '@/features/cadastro/planos/hooks/use-planos';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  FormaPagamentoValue,
  RematriculaElegivelItem,
  RematriculaCampaignSummary,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';
import {
  createRematriculaRequest,
  editRematriculaFutureLinkRequest,
  previewIndividualRematriculaRequest,
  type CreateRematriculaInput,
  type RematriculaProcessSummary,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';
import { useModelos } from '@/features/contratos/hooks/use-modelos';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { InfoCallout } from '@/components/ui/info-callout';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';
import { RematriculaDiscountSelector } from './RematriculaDiscountSelector';

const HERDAR_FORMA_VALUE = 'HERDAR';

const formaPagamentoOptions: Array<{
  value: FormaPagamentoValue;
  label: string;
  helper: string;
}> = [
  {
    value: 'BOLETO',
    label: 'Boleto bancário',
    helper: 'Gera boleto compatível com carnê/recorrência',
  },
  {
    value: 'PIX',
    label: 'Pix recorrente',
    helper: 'Usa QR Code com reapresentação automática',
  },
  {
    value: 'CARTAO_CREDITO',
    label: 'Cartão de crédito',
    helper: 'Cria assinatura com tokenização segura',
  },
  {
    value: 'INDEFINIDO',
    label: 'Definir depois',
    helper: 'Mantém cobrança manual (valor aberto)',
  },
];

interface RematriculaDialogProps {
  open: boolean;
  contaId?: string;
  campaignId?: string | null;
  campaigns?: RematriculaCampaignSummary[];
  targetPeriodId?: string;
  mode?: 'CREATE' | 'EDIT_FUTURE';
  item: RematriculaElegivelItem | null;
  process?: RematriculaProcessSummary | null;
  onOpenChange: (_open: boolean) => void;
  onCreated?: () => void;
  onEdited?: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return dateFormatter.format(d);
}

function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const dateOnly = value.includes('T') ? value.slice(0, 10) : value;
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberFromSnapshot(snapshot: Record<string, unknown>, key: string): number | null {
  const value = snapshot[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFromSnapshot(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function booleanFromSnapshot(snapshot: Record<string, unknown>, key: string): boolean | null {
  const value = snapshot[key];
  return typeof value === 'boolean' ? value : null;
}

function normalizePaymentMethodForApi(value: string): 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null {
  if (value === 'BOLETO' || value === 'PIX' || value === 'CARTAO_CREDITO') return value;
  return null;
}

function formatTurmaHorario(
  horaInicio: string | null | undefined,
  horaFim: string | null | undefined,
): string {
  if (horaInicio && horaFim) return `${horaInicio} às ${horaFim}`;
  if (horaInicio) return `A partir de ${horaInicio}`;
  if (horaFim) return `Até ${horaFim}`;
  return 'Horário flexível';
}

function formatTurmaDias(diasSemana: string[] | null | undefined): string {
  if (!diasSemana || diasSemana.length === 0) return 'Dias flexíveis';
  return diasSemana.join(', ');
}

function formatTurmaCapacidade(capacidade: number, vagasOcupadas: number): string {
  const vagasRestantes = Math.max(0, capacidade - vagasOcupadas);

  if (vagasRestantes === 0) return 'Lotada';
  if (vagasRestantes === 1) return '1 vaga disponível';

  return `${vagasRestantes} vagas disponíveis`;
}

// Classes de estilo consistentes com AlunoEditDialog
const controlClass =
  'flex h-11 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10 md:min-h-0';
const fieldTriggerClass =
  'h-11 min-h-11 w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10 md:min-h-0';
const textAreaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 resize-none';
const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';

export function RematriculaDialog({
  open,
  contaId,
  campaignId,
  campaigns = [],
  targetPeriodId,
  mode = 'CREATE',
  item,
  process,
  onOpenChange,
  onCreated,
  onEdited,
}: RematriculaDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [closeAlertOpen, setCloseAlertOpen] = useState(false);
  const allowCloseRef = useRef(false);

  function closeDialog() {
    allowCloseRef.current = true;
    setCloseAlertOpen(false);
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

  const sanitizeMessage = (message: string) =>
    message
      .replace(/Asaas/gi, 'financeiro')
      .replace(/webhooks?/gi, 'atualizações automáticas')
      .replace(/assinatura financeira/gi, 'dados de cobrança')
      .replace(/assinatura/gi, 'renovação')
      .replace(/provedor/gi, 'serviço financeiro')
      .trim();

  // Dados do contrato
  const [dataInicio, setDataInicio] = useState('');
  const [dataFimContrato, setDataFimContrato] = useState('');
  const [contratoModeloId, setContratoModeloId] = useState<string | null>(null);
  const [vencimentoDia, setVencimentoDia] = useState<number | ''>('');

  // Seleção de plano e turma
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [turmaId, setTurmaId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(campaignId ?? null);

  // Forma de pagamento
  const [formaPagamento, setFormaPagamento] = useState<string>(HERDAR_FORMA_VALUE);
  const [formaPagamentoTaxa, setFormaPagamentoTaxa] = useState<string>(HERDAR_FORMA_VALUE);

  // Taxa de matrícula
  const [taxaMatricula, setTaxaMatricula] = useState('');
  const [taxaIsenta, setTaxaIsenta] = useState(false);
  const [taxaJustificativa, setTaxaJustificativa] = useState('');

  // Regras de atraso
  const [multaPercentual, setMultaPercentual] = useState('');
  const [jurosMensal, setJurosMensal] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Desconto antecipado
  const [descontoAntecipado, setDescontoAntecipado] = useState('');
  const [descontoTipo, setDescontoTipo] = useState<'FIXED' | 'PERCENTAGE'>('PERCENTAGE');
  const [prazoDesconto, setPrazoDesconto] = useState('');
  const [notificationChannels, setNotificationChannels] = useState<Array<'EMAIL' | 'SMS' | 'WHATSAPP'>>([
    'EMAIL',
    'SMS',
  ]);
  const [selectedDiscountIds, setSelectedDiscountIds] = useState<string[]>([]);
  const [futureBillingStrategy, setFutureBillingStrategy] = useState<CreateRematriculaInput['futureBillingStrategy']>();
  const [futureAgreementCandidates, setFutureAgreementCandidates] = useState<NonNullable<Awaited<ReturnType<typeof previewIndividualRematriculaRequest>>['futureAgreementCandidates']>>([]);

  // Buscar turmas e planos disponíveis
  const { items: turmasDisponiveis, loading: turmasLoading } = useTurmas({ contaId });
  const { items: planosDisponiveis, loading: planosLoading } = usePlanos({ contaId });
  const { modelos: contratoModelos, loading: contratoModelosLoading } = useModelos({
    activeOnly: true,
  });

  // Turmas ativas disponíveis
  const turmasFiltradas = useMemo(() => {
    return turmasDisponiveis.filter((turma) => turma.status === 'ATIVO');
  }, [turmasDisponiveis]);

  const turmaSelecionada = useMemo(() => {
    if (!turmaId) return null;
    return turmasFiltradas.find((turma) => turma.id === turmaId) ?? null;
  }, [turmaId, turmasFiltradas]);

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

  const turmaLotada = (turmaId: string | null) => {
    if (!turmaId) return false;
    const turma = turmasFiltradas.find((t) => t.id === turmaId);
    if (!turma) return false;
    return turma.vagasOcupadas >= turma.capacidade;
  };

  // Preencher valores iniciais quando item muda
  useEffect(() => {
    if (!item) return;

    const futureItem = process?.itens.find((processItem) => processItem.decision === 'RENEW') ?? process?.itens[0];
    const futureEnrollment = futureItem?.matriculaFutura;
    const futureContract = process?.contratos[0];
    const futureFinancial = process?.financeiros[0];
    const financialSnapshot = futureFinancial?.snapshot ?? {};

    setDataInicio(
      mode === 'EDIT_FUTURE' && (futureEnrollment?.dataInicio || process?.effectiveAt)
        ? formatDateInput(parseDateOnly(futureEnrollment?.dataInicio ?? process!.effectiveAt))
        : '',
    );
    setDataFimContrato(
      mode === 'EDIT_FUTURE' && (futureEnrollment?.dataFimContrato || futureContract?.validUntil)
        ? formatDateInput(parseDateOnly(futureEnrollment?.dataFimContrato ?? futureContract!.validUntil!))
        : '',
    );
    setSelectedCampaignId(campaignId ?? null);
    setContratoModeloId(mode === 'EDIT_FUTURE' ? futureContract?.contractModelId ?? null : null);

    setPlanoId(
      mode === 'EDIT_FUTURE'
        ? futureEnrollment?.planoId ?? futureItem?.targetPlanId ?? item.plano?.id ?? null
        : item.plano?.id ?? null,
    );
    setTurmaId(
      mode === 'EDIT_FUTURE'
        ? futureEnrollment?.turmaId ?? futureItem?.targetClassId ?? item.turma?.id ?? null
        : item.turma?.id ?? null,
    );

    const financeiro = item.financeiro;
    const snapshotDueDay = numberFromSnapshot(financialSnapshot, 'dueDay');
    const snapshotEnrollmentFeeAmount =
      numberFromSnapshot(financialSnapshot, 'enrollmentFeeAmount') ??
      numberFromSnapshot(financialSnapshot, 'enrollmentFeeTotal');
    const snapshotEnrollmentFeeExempt = booleanFromSnapshot(financialSnapshot, 'enrollmentFeeExempt');
    setVencimentoDia(
      mode === 'EDIT_FUTURE' && snapshotDueDay != null
        ? snapshotDueDay
        : financeiro?.vencimentoDia ?? '',
    );
    setFormaPagamento(
      mode === 'EDIT_FUTURE' && stringFromSnapshot(financialSnapshot, 'paymentMethod')
        ? stringFromSnapshot(financialSnapshot, 'paymentMethod')!
        : financeiro?.formaPagamento ?? HERDAR_FORMA_VALUE,
    );
    setFormaPagamentoTaxa(
      mode === 'EDIT_FUTURE' && stringFromSnapshot(financialSnapshot, 'enrollmentFeePaymentMethod')
        ? stringFromSnapshot(financialSnapshot, 'enrollmentFeePaymentMethod')!
        : financeiro?.formaPagamentoTaxa ?? HERDAR_FORMA_VALUE,
    );
    setTaxaMatricula(
      mode === 'EDIT_FUTURE' && snapshotEnrollmentFeeAmount != null
        ? String(snapshotEnrollmentFeeAmount)
        : financeiro?.taxaMatricula != null
          ? String(financeiro.taxaMatricula)
          : '',
    );
    setTaxaIsenta(
      mode === 'EDIT_FUTURE'
        ? Boolean(snapshotEnrollmentFeeExempt ?? (futureFinancial?.enrollmentFeeTotal ?? financeiro?.taxaMatricula ?? 0) <= 0)
        : Boolean(financeiro?.taxaIsenta),
    );
    setTaxaJustificativa(
      mode === 'EDIT_FUTURE' && stringFromSnapshot(financialSnapshot, 'enrollmentFeeJustification')
        ? stringFromSnapshot(financialSnapshot, 'enrollmentFeeJustification')!
        : financeiro?.taxaJustificativa ?? '',
    );
    setMultaPercentual(
      mode === 'EDIT_FUTURE' && numberFromSnapshot(financialSnapshot, 'lateFeePercent') != null
        ? String(numberFromSnapshot(financialSnapshot, 'lateFeePercent'))
        : financeiro?.multaPercentual != null ? String(financeiro.multaPercentual) : '',
    );
    setJurosMensal(
      mode === 'EDIT_FUTURE' && numberFromSnapshot(financialSnapshot, 'interestMonthlyPercent') != null
        ? String(numberFromSnapshot(financialSnapshot, 'interestMonthlyPercent'))
        : financeiro?.jurosMensal != null ? String(financeiro.jurosMensal) : '',
    );
    setDescontoAntecipado(
      mode === 'EDIT_FUTURE' && numberFromSnapshot(financialSnapshot, 'earlyDiscountPercent') != null
        ? String(numberFromSnapshot(financialSnapshot, 'earlyDiscountPercent'))
        : financeiro?.descontoAntecipado != null ? String(financeiro.descontoAntecipado) : '',
    );
    setPrazoDesconto(
      mode === 'EDIT_FUTURE' && numberFromSnapshot(financialSnapshot, 'earlyDiscountDays') != null
        ? String(numberFromSnapshot(financialSnapshot, 'earlyDiscountDays'))
        : financeiro?.prazoDesconto != null ? String(financeiro.prazoDesconto) : '',
    );
    setDescontoTipo(
      mode === 'EDIT_FUTURE' && stringFromSnapshot(financialSnapshot, 'discountType') === 'FIXED'
        ? 'FIXED'
        : financeiro?.descontoTipo === 'FIXED'
          ? 'FIXED'
        : 'PERCENTAGE',
    );
    setOverrideReason('');
    setFutureBillingStrategy(undefined);
    setFutureAgreementCandidates([]);
    // Descontos da matrícula atual não são herdados automaticamente.
    // O usuário precisa selecionar explicitamente um desconto ativo para o novo ciclo.
    setSelectedDiscountIds([]);
  }, [campaignId, item, mode, process]);

  useEffect(() => {
    if (!item) return;
    if (mode === 'CREATE' && planoId && planoId !== item.plano?.id) {
      setTurmaId(null);
    }
  }, [planoId, item, mode]);

  const validacaoDatas = useMemo(() => {
    if (!item || !dataInicio) return { valido: true, erro: null };

    const dataInicioDate = parseDateOnly(dataInicio);
    const dataFimContratoAtual = parseDateOnly(item.dataFimContrato);

    if (dataInicioDate < dataFimContratoAtual) {
      return {
        valido: false,
        erro: `A data de início deve ser igual ou posterior a ${formatDate(dataFimContratoAtual)}`,
      };
    }

    // dataFimContrato é obrigatória para definir endDate
    if (!dataFimContrato) {
      return {
        valido: false,
        erro: 'A data de término do contrato futuro é obrigatória para confirmar o próximo ciclo',
      };
    }

    const dataFimContratoNovoDate = parseDateOnly(dataFimContrato);
    if (dataFimContratoNovoDate <= dataInicioDate) {
      return {
        valido: false,
        erro: 'A data de término do contrato deve ser posterior à data de início',
      };
    }

    return { valido: true, erro: null };
  }, [item, dataInicio, dataFimContrato]);

  const requiresOverrideReason = Boolean(item?.financeiro.requiresOverrideReason);
  const needsOverride = item?.financeiro.rematriculaActionStatus === 'REQUER_OVERRIDE';
  const blockedByPolicy = item?.financeiro.rematriculaActionStatus === 'BLOQUEADA';

  const disabled =
    !contaId ||
    !item ||
    (mode === 'CREATE' && !item.podeRenovar) ||
    blockedByPolicy ||
    submitting ||
    !validacaoDatas.valido ||
    !dataInicio ||
    !planoId ||
    !dataFimContrato ||
    (mode === 'CREATE' && !contratoModeloId) ||
    (needsOverride && requiresOverrideReason && !overrideReason.trim());


  const parseDecimal = (value: string) => {
    if (!value || !value.trim()) return undefined;
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  };

  const parseIntegerString = (value: string) => {
    if (!value || !value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
  };

  const toggleNotificationChannel = (channel: 'EMAIL' | 'SMS' | 'WHATSAPP') => {
    setNotificationChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contaId || !item || !planoId) return;

    if (mode === 'EDIT_FUTURE') {
      if (!process) return;
      const editReason =
        overrideReason.trim().length >= 5
          ? overrideReason.trim()
          : 'Ajuste administrativo do próximo ciclo pela tela de rematrículas.';
      try {
        setSubmitting(true);
        await editRematriculaFutureLinkRequest(process.id, {
          targetClassId: turmaId || null,
          targetPlanId: planoId,
          holderType: process.holderType,
          holderId: process.holderId,
          effectiveAt: dataInicio ? new Date(dataInicio).toISOString() : null,
          firstDueDate:
            vencimentoDia && typeof vencimentoDia === 'number' && dataInicio
              ? new Date(new Date(dataInicio).getFullYear(), new Date(dataInicio).getMonth(), vencimentoDia).toISOString()
              : process.firstDueDate,
          targetContractEndsAt: dataFimContrato ? new Date(dataFimContrato).toISOString() : null,
          contractModelId: contratoModeloId,
          paymentMethod: normalizePaymentMethodForApi(formaPagamento),
          enrollmentFeePaymentMethod:
            normalizePaymentMethodForApi(formaPagamentoTaxa),
          dueDay: vencimentoDia && typeof vencimentoDia === 'number' ? vencimentoDia : null,
          enrollmentFeeAmount: taxaIsenta ? 0 : parseDecimal(taxaMatricula) ?? null,
          enrollmentFeeExempt: taxaIsenta,
          enrollmentFeeJustification: taxaJustificativa.trim() || null,
          feeChargeMoment: taxaIsenta ? 'EXEMPT' : 'CHARGE_ON_START',
          feeUnit: taxaIsenta ? 'NO_FEE' : 'PER_STUDENT',
          feePurpose: 'ADMINISTRATIVE_FEE',
          lateFeePercent: parseDecimal(multaPercentual) ?? null,
          interestMonthlyPercent: parseDecimal(jurosMensal) ?? null,
          earlyDiscountPercent: parseDecimal(descontoAntecipado) ?? null,
          earlyDiscountType: descontoTipo,
          earlyDiscountDays: parseIntegerString(prazoDesconto) ?? null,
          reason: editReason,
        });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Próximo ciclo atualizado"
            description="As predefinições futuras foram atualizadas. A matrícula atual permanece preservada."
            onClose={() => toast.dismiss(t)}
          />
        ));
        onEdited?.();
        closeDialog();
      } catch (error) {
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Erro ao editar próximo ciclo"
            description={sanitizeMessage(
              (error as Error).message || 'Não foi possível editar o próximo ciclo.',
            )}
            onClose={() => toast.dismiss(t)}
          />
        ));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const payload: CreateRematriculaInput = {
      contaId,
      campaignId: effectiveCampaignId,
      targetPeriodId: effectiveTargetPeriodId,
      matriculaId: item.id,
      dataInicio: dataInicio ? new Date(dataInicio).toISOString() : new Date().toISOString(),
      dataFimContrato: dataFimContrato
        ? new Date(dataFimContrato).toISOString()
        : new Date(item.dataFimContrato).toISOString(),
      planoId: planoId ?? item.plano?.id ?? undefined,
      turmaId: turmaId ?? item.turma?.id ?? undefined,
      contractModelId: contratoModeloId,
      billingMode: 'INDIVIDUAL',
      futureBillingStrategy,
    };

    if (vencimentoDia && typeof vencimentoDia === 'number') {
      payload.vencimentoDia = vencimentoDia;
    }

    if (formaPagamento !== HERDAR_FORMA_VALUE) {
      payload.formaPagamento = formaPagamento;
    }
    if (formaPagamentoTaxa !== HERDAR_FORMA_VALUE) {
      payload.formaPagamentoTaxa = formaPagamentoTaxa;
    }

    payload.taxaIsenta = taxaIsenta;

    const taxaValor = parseDecimal(taxaMatricula);
    if (taxaIsenta) {
      payload.taxaMatricula = 0;
    } else if (typeof taxaValor === 'number') {
      payload.taxaMatricula = Math.max(0, Number(taxaValor.toFixed(2)));
    }
    if (taxaJustificativa.trim()) {
      payload.taxaJustificativa = taxaJustificativa.trim();
    }

    const multaValor = parseDecimal(multaPercentual);
    if (typeof multaValor === 'number') {
      payload.multaPercentual = Math.min(10, Math.max(0, Number(multaValor.toFixed(2))));
    }

    const jurosValor = parseDecimal(jurosMensal);
    if (typeof jurosValor === 'number') {
      payload.jurosMensal = Math.min(5, Math.max(0, Number(jurosValor.toFixed(2))));
    }

    const descontoValor = parseDecimal(descontoAntecipado);
    if (typeof descontoValor === 'number') {
      payload.descontoAntecipado = Math.min(
        descontoTipo === 'PERCENTAGE' ? 100 : 99999,
        Math.max(0, Number(descontoValor.toFixed(2))),
      );
    }
    payload.descontoTipo = descontoTipo;

    const prazoValor = parseIntegerString(prazoDesconto);
    if (typeof prazoValor === 'number') {
      payload.prazoDesconto = Math.min(30, Math.max(0, prazoValor));
    }

    payload.descontos = selectedDiscountIds.map((id) => ({ id }));
    payload.notificationChannels = notificationChannels;
    payload.notificationChannelsConfigured = true;

    if (needsOverride && overrideReason.trim()) {
      payload.overrideReason = overrideReason.trim();
    }

    try {
      setSubmitting(true);
      const billingPreview = await previewIndividualRematriculaRequest(payload);
      if (billingPreview.blockers.length > 0) {
        throw new Error(billingPreview.blockers[0]?.message ?? 'O preview possui bloqueios.');
      }
      const selectableFutureAgreements = billingPreview.futureAgreementCandidates.filter((candidate) => candidate.canUnify);
      if (selectableFutureAgreements.length > 0 && !futureBillingStrategy) {
        setFutureAgreementCandidates(billingPreview.futureAgreementCandidates);
        return;
      }
      setFutureAgreementCandidates(billingPreview.futureAgreementCandidates);
      await createRematriculaRequest(payload);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Rematrícula confirmada"
          description="O próximo ciclo foi preparado. A matrícula atual permanece intacta até a data de início."
          onClose={() => toast.dismiss(t)}
        />
      ));
      onCreated?.();
      closeDialog();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao confirmar próximo ciclo"
          description={sanitizeMessage(
            (error as Error).message || 'Não foi possível confirmar o próximo ciclo.',
          )}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        fullScreenMobile
        data-testid="rematricula-dialog"
        className="flex w-[calc(100vw-2rem)] max-w-[920px] min-h-0 flex-col gap-0 overflow-hidden bg-slate-50 p-0 max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[calc(100dvh-4rem)] md:rounded-2xl"
      >
        {item && (
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0"
          >
            {/* Header */}
            <div className="relative border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
              <DialogTitle className="pr-2 text-xl font-semibold text-slate-900 md:pr-0">
                {mode === 'EDIT_FUTURE' ? 'Editar próximo ciclo' : 'Preparar próximo ciclo'}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-slate-600">
                {mode === 'EDIT_FUTURE'
                  ? 'Revise os dados já preparados para o próximo ciclo. A matrícula e as cobranças do ciclo atual serão preservadas.'
                  : 'Configure o vínculo futuro, a reserva e as condições financeiras agendadas.'}
              </DialogDescription>
            </div>

            {/* Content */}
            <div
              className="flex-1 space-y-6 overflow-y-auto scroll-smooth px-4 py-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent max-md:min-h-0 md:px-8 md:py-6"
              style={{
                scrollbarWidth: 'thin',
                scrollbarGutter: 'stable',
                scrollbarColor: '#d1d5db transparent',
              }}
            >
              {/* Dados do Aluno (Read-only) */}
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Dados do aluno</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className={labelClass}>Nome</label>
                    <Input
                      value={item.aluno.nome || ''}
                      disabled
                      className="h-11 min-h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-900 shadow-sm md:h-10 md:min-h-0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>CPF</label>
                    <Input
                      value={formatCpf(item.aluno.cpf)}
                      disabled
                      className="h-11 min-h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-900 shadow-sm md:h-10 md:min-h-0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Contrato anterior</label>
                    <Input
                      value={`${formatDate(item.dataInicio)} — ${formatDate(item.dataFimContrato)}`}
                      disabled
                      className="h-11 min-h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-900 shadow-sm md:h-10 md:min-h-0"
                    />
                  </div>
                </div>
              </div>

              {mode === 'CREATE' && !campaignId ? (
                <div className={sectionClass}>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">Campanha (Opcional)</span>
                    <p className="text-xs text-slate-500">
                      Vincule esta rematrícula a uma campanha para acompanhar a operação.
                    </p>
                  </div>
                  <Select
                    value={selectedCampaignId ?? 'none'}
                    onValueChange={(value) => setSelectedCampaignId(value === 'none' ? null : value)}
                  >
                    <SelectTrigger className={fieldTriggerClass}>
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
                    <p className="text-xs text-slate-500">Nenhuma campanha ativa disponível.</p>
                  ) : null}
                </div>
              ) : null}

              {mode === 'EDIT_FUTURE' ? (
                <div className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Edição</span>
                  <InfoCallout variant="info" size="md" showIcon={false}>
                    <p className="font-medium">Editando próximo ciclo</p>
                    <p className="mt-1 text-xs opacity-90">
                      Esta alteração atualiza somente artefatos futuros ainda reversíveis. Processos já efetivados ou cancelados permanecem bloqueados.
                    </p>
                  </InfoCallout>
                  <div className="space-y-1">
                    <label className={labelClass}>Justificativa da alteração</label>
                    <textarea
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      rows={3}
                      placeholder="Explique por que o próximo ciclo está sendo alterado."
                      className={textAreaClass}
                    />
                  </div>
                </div>
              ) : needsOverride ? (
                <div className={sectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Autorização necessária</span>
                  <InfoCallout variant="warning" size="md" showIcon={false}>
                    <p className="font-medium">
                      Esta rematrícula exige autorização da gestão.
                    </p>
                  </InfoCallout>

                  {needsOverride ? (
                    <div className="space-y-1">
                      <label className={labelClass}>Motivo da autorização</label>
                      <textarea
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        rows={3}
                        placeholder="Descreva por que a escola está autorizando esta rematrícula neste caso."
                        className={textAreaClass}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Plano e Turma */}
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Plano e turma</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Plano</label>
                      <FieldHelpTooltip
                        label="Sobre o plano"
                        content="O plano determina o valor da mensalidade e a modalidade."
                      />
                    </div>
                    <Select
                      value={planoId ?? 'null'}
                      onValueChange={(v) => setPlanoId(v === 'null' ? null : v)}
                      disabled={planosLoading}
                    >
                      <SelectTrigger className={fieldTriggerClass}>
                        <SelectValue placeholder="Selecione o plano" />
                      </SelectTrigger>
                      <SelectContent>
                        {planosDisponiveis
                          .filter((plano) => plano.status === 'ATIVO')
                          .map((plano) => (
                            <SelectItem key={plano.id} value={plano.id}>
                              <div className="flex min-w-0 items-baseline gap-1.5 text-left">
                                <span className="truncate font-medium text-slate-900">
                                  {plano.nome}
                                </span>
                                <span className="truncate text-xs text-slate-500">
                                  ({currencyFormatter.format(Number(plano.valor))})
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Turma</label>
                      <FieldHelpTooltip
                        label="Sobre a turma"
                        content="Selecione uma turma ativa disponível."
                      />
                    </div>
                    <Select
                      value={turmaId ?? 'null'}
                      onValueChange={(v) => setTurmaId(v === 'null' ? null : v)}
                      disabled={turmasLoading}
                    >
                      <SelectTrigger className={fieldTriggerClass}>
                        {turmaSelecionada ? (
                          <div className="flex min-w-0 items-baseline gap-1.5 text-left">
                            <span className="truncate font-medium text-slate-900">
                              {turmaSelecionada.nome}
                            </span>
                            <span className="truncate text-xs text-slate-500">
                              (
                              {formatTurmaHorario(
                                turmaSelecionada.horaInicio,
                                turmaSelecionada.horaFim,
                              )}
                              )
                            </span>
                          </div>
                        ) : (
                          <SelectValue placeholder="Selecione a turma" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="null" className="group">
                          Sem turma definida
                        </SelectItem>
                        {turmasFiltradas.map((turma) => {
                          const lotada = turma.vagasOcupadas >= turma.capacidade;
                          return (
                            <SelectItem
                              key={turma.id}
                              value={turma.id}
                              disabled={lotada}
                              className="group py-1.5 data-[highlighted]:bg-[#8B2FF5] data-[state=checked]:bg-[#8B2FF5]"
                            >
                              <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
                                <span className="truncate font-medium text-slate-900 group-data-[highlighted]:text-white group-data-[state=checked]:text-white">
                                  {turma.nome}
                                </span>
                                <span className="truncate text-xs text-slate-500 group-data-[highlighted]:text-violet-100 group-data-[state=checked]:text-violet-100">
                                  {formatTurmaHorario(turma.horaInicio, turma.horaFim)}
                                  {' • '}
                                  {formatTurmaDias(turma.diasSemana)}
                                  {' • '}
                                  {formatTurmaCapacidade(turma.capacidade, turma.vagasOcupadas)}
                                </span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {turmaLotada(turmaId) && (
                      <p className="text-xs text-red-600">Esta turma está sem vagas disponíveis.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Período do Contrato */}
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Período do contrato</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className={labelClass}>Data de início</label>
                    <Input
                      type="date"
                      value={dataInicio}
                      onChange={(e) => setDataInicio(e.target.value)}
                      className={`h-11 min-h-11 rounded-lg border px-3 text-sm text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 md:h-10 md:min-h-0 ${
                        !validacaoDatas.valido
                          ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/30'
                          : 'border-slate-200 bg-white focus:border-[#A94DFF] focus:ring-[#A94DFF]/30'
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Término do contrato</label>
                    <Input
                      type="date"
                      value={dataFimContrato}
                      onChange={(e) => setDataFimContrato(e.target.value)}
                      required
                      className={`${controlClass} ${!dataFimContrato ? 'border-amber-300' : ''}`}
                    />
                  </div>
                </div>
                {!validacaoDatas.valido && validacaoDatas.erro && (
                  <InfoCallout variant="warning" size="sm" showIcon>
                    {validacaoDatas.erro}
                  </InfoCallout>
                )}
              </div>

              <div className={sectionClass}>
                <div>
                  <span className="text-sm font-semibold text-slate-700">Contrato</span>
                  <p className="text-xs text-slate-500">
                    Selecione o modelo que será preparado para o contrato futuro.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <label className={labelClass}>Modelo de contrato</label>
                    <FieldHelpTooltip content="O contrato futuro será preparado junto com o próximo ciclo. Se não houver modelo ativo, cadastre um em Contratos > Modelos." />
                  </div>
                  <Select
                    value={contratoModeloId ?? 'null'}
                    onValueChange={(value) => setContratoModeloId(value === 'null' ? null : value)}
                    disabled={contratoModelosLoading || contratoModelos.length === 0}
                  >
                    <SelectTrigger className={fieldTriggerClass}>
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

              {/* Condições de Pagamento */}
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Condições de pagamento</span>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <label className={labelClass}>Forma de pagamento</label>
                      <FieldHelpTooltip
                        label="Sobre a forma de pagamento"
                        content={
                          formaPagamento === HERDAR_FORMA_VALUE
                            ? 'Usará a forma configurada na matrícula atual.'
                            : formaPagamentoOptions.find((o) => o.value === formaPagamento)?.helper ?? ''
                        }
                      />
                    </div>
                    <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                      <SelectTrigger className={fieldTriggerClass}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={HERDAR_FORMA_VALUE}>Manter atual</SelectItem>
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
                      <FieldHelpTooltip
                        label="Sobre o dia de vencimento"
                        content="Entre 1 e 28."
                      />
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={vencimentoDia === '' ? '' : String(vencimentoDia)}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        if (!Number.isFinite(parsed)) {
                          setVencimentoDia('');
                          return;
                        }
                        setVencimentoDia(Math.min(28, Math.max(1, parsed)));
                      }}
                      placeholder="1–28"
                      className={controlClass}
                    />
                  </div>
                </div>
                <RematriculaDiscountSelector
                  contaId={contaId}
                  selectedIds={selectedDiscountIds}
                  onChange={setSelectedDiscountIds}
                />
              </div>

              {/* Taxa de Matrícula */}
              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Taxa de matrícula</span>
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <Checkbox
                    id="taxa-isenta"
                    checked={taxaIsenta}
                    onCheckedChange={(checked) => setTaxaIsenta(Boolean(checked))}
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="taxa-isenta"
                        className="cursor-pointer text-sm font-medium text-slate-700"
                      >
                        Isentar taxa nesta rematrícula
                      </label>
                      <FieldHelpTooltip
                        label="Sobre isentar a taxa"
                        content="Nenhuma cobrança será enviada ao responsável."
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className={labelClass}>Valor (R$)</label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={taxaMatricula}
                      onChange={(e) => setTaxaMatricula(e.target.value)}
                      disabled={taxaIsenta}
                      placeholder="0,00"
                      className={`${controlClass} disabled:bg-slate-100 disabled:opacity-60`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Forma de pagamento da taxa</label>
                    <Select
                      value={formaPagamentoTaxa}
                      onValueChange={setFormaPagamentoTaxa}
                      disabled={taxaIsenta}
                    >
                      <SelectTrigger className={`${fieldTriggerClass} disabled:bg-slate-100 disabled:opacity-60`}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={HERDAR_FORMA_VALUE}>Manter atual</SelectItem>
                        {formaPagamentoOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Justificativa (opcional)</label>
                  <textarea
                    value={taxaJustificativa}
                    onChange={(e) => setTaxaJustificativa(e.target.value)}
                    placeholder="Motivo da isenção ou observação..."
                    rows={2}
                    className={textAreaClass}
                  />
                </div>
              </div>

              {/* Regras Financeiras */}
              <div className={sectionClass}>
                <div>
                  <span className="text-sm font-semibold text-slate-700">Juros e Multa</span>
                  <p className="mt-1 text-xs text-slate-500">
                    Configure multa, juros e desconto por antecipação. Campos opcionais.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-gray-900">Multa por atraso</h3>
                    <p className="mb-3 text-xs text-gray-500">Aplicada no dia seguinte ao vencimento</p>
                    <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={multaPercentual}
                      onChange={(e) => setMultaPercentual(e.target.value)}
                      placeholder="Ex: 2.0"
                      className="h-9 w-24 rounded-md border-slate-300 text-sm"
                    />
                      <span className="text-sm text-gray-600">%</span>
                      <span className="ml-auto text-xs text-gray-400">máx. 10%</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-gray-900">Juros mensais</h3>
                    <p className="mb-3 text-xs text-gray-500">Aplicados proporcionalmente aos dias em atraso</p>
                    <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      value={jurosMensal}
                      onChange={(e) => setJurosMensal(e.target.value)}
                      placeholder="Ex: 1.0"
                      className="h-9 w-24 rounded-md border-slate-300 text-sm"
                    />
                      <span className="text-sm text-gray-600">% a.m.</span>
                      <span className="ml-auto text-xs text-gray-400">máx. 5%</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 sm:col-span-2">
                    <h3 className="mb-1 text-sm font-semibold text-gray-900">Desconto por antecipação</h3>
                    <p className="mb-3 text-xs text-gray-500">Incentivo para pagamento antes do vencimento</p>
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs text-gray-600">Tipo</label>
                        <Tabs
                          value={descontoTipo}
                          onValueChange={(value) => setDescontoTipo(value as 'FIXED' | 'PERCENTAGE')}
                        >
                          <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1">
                            <TabsTrigger value="PERCENTAGE" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">
                              %
                            </TabsTrigger>
                            <TabsTrigger value="FIXED" className="h-8 min-w-24 rounded-lg px-4 py-0 text-sm shadow-none">
                              R$
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-gray-600">Valor</label>
                        <Input
                          type="number"
                          min={0}
                          max={descontoTipo === 'PERCENTAGE' ? 100 : 99999}
                          step={0.1}
                          value={descontoAntecipado}
                          onChange={(e) => setDescontoAntecipado(e.target.value)}
                          placeholder={descontoTipo === 'PERCENTAGE' ? '5.0' : '10.00'}
                          className="h-9 w-24 rounded-md border-slate-300 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-gray-600">Prazo (dias antes)</label>
                        <Input
                          type="number"
                          min={0}
                          max={30}
                          value={prazoDesconto}
                          onChange={(e) => setPrazoDesconto(e.target.value)}
                          placeholder="0"
                          className="h-9 w-20 rounded-md border-slate-300 text-sm"
                        />
                      </div>
                      <span className="pb-2 text-xs text-gray-400">0 = válido até o vencimento</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Deixe os campos vazios para não aplicar estas configurações.
                </p>
              </div>

              <div className={sectionClass}>
                <span className="text-sm font-semibold text-slate-700">Notificações</span>
                <p className="text-xs text-slate-500">
                  Canais para avisos de cobranças futuras ao responsável. Toque para confirmar a sugestão da régua global.
                </p>
                <div className="flex flex-wrap gap-3">
                  {([
                    ['WHATSAPP', 'WhatsApp'],
                    ['EMAIL', 'E-mail'],
                    ['SMS', 'SMS'],
                  ] as const).map(([channel, label]) => {
                    const selected = notificationChannels.includes(channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => toggleNotificationChannel(channel)}
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                          selected
                            ? 'border-[#5c2f91] bg-[#5c2f91] text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-[#5c2f91] hover:text-[#5c2f91]'
                        }`}
                        aria-pressed={selected}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {futureAgreementCandidates.length > 0 && !futureBillingStrategy && mode === 'CREATE' ? (
              <div className="mx-4 mb-6 space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 md:mx-8">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Cobrança futura já encontrada</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Escolha se esta rematrícula será adicionada à cobrança existente ou se terá uma cobrança separada.
                  </p>
                </div>
                {futureAgreementCandidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {candidate.studentNames.join(', ') || 'Outro vínculo'}
                        </p>
                        <p className="text-xs text-slate-500">
                          R$ {candidate.monthlyTotal.toFixed(2).replace('.', ',')} · {candidate.periodicity ?? 'periodicidade não informada'}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-slate-600">
                        {candidate.canUnify ? 'Unificação disponível' : 'Exige conferência'}
                      </span>
                    </div>
                    {candidate.reason ? <p className="mt-2 text-xs text-amber-700">{candidate.reason}</p> : null}
                    {candidate.canUnify ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setFutureBillingStrategy({ mode: 'UNIFY_EXISTING', agreementId: candidate.id })}>
                          Unificar nesta cobrança
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setFutureBillingStrategy({ mode: 'SEPARATE', agreementId: null })}>
                          Cobrar separadamente
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Footer */}
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-8 md:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full min-w-0 border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto md:min-w-[140px]"
                onClick={requestClose}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={disabled}
                className="h-11 min-h-11 w-full min-w-0 bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[160px]"
              >
                {submitting ? 'Salvando...' : mode === 'EDIT_FUTURE' ? 'Salvar alterações' : 'Salvar'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
      </Dialog>

    <AlertDialog open={closeAlertOpen} onOpenChange={setCloseAlertOpen}>
      <AlertDialogContent className="max-w-md rounded-xl border border-slate-200 bg-white">
        <AlertDialogHeader className="space-y-2 text-left">
          <AlertDialogTitle className="text-lg font-medium text-slate-900">
            Sair da rematrícula?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-600">
            As informações preenchidas serão descartadas. Deseja realmente sair?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            Continuar
          </AlertDialogCancel>
          <AlertDialogAction className="bg-brand-accent text-white hover:bg-brand-accent/90" onClick={closeDialog}>
            Sair
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
