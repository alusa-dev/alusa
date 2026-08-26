import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModelos } from '@/features/contratos/hooks/use-modelos';
import type { WizardContextValue } from '../types';
import { calcularValorLiquidoComBeneficio } from '../beneficios';
import { calculateFamilyMonthlyTotal } from '../family-pricing';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');
const CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function parseStoredDate(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDate(date?: Date) {
  if (!date) return undefined;
  const normalized = normalizeDate(date);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, '0');
  const day = String(normalized.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDueDay(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 28;
}

function resolveFirstDueDate(dataInicio: Date, vencimentoDia: number) {
  const base = normalizeDate(dataInicio);
  const day = Math.min(28, Math.max(1, vencimentoDia));
  const due = new Date(base.getFullYear(), base.getMonth(), day);
  if (due < base) {
    return new Date(base.getFullYear(), base.getMonth() + 1, day);
  }
  return due;
}

function resolveChargeableFirstDueDate(dataInicio: Date, vencimentoDia: number) {
  const day = Math.min(28, Math.max(1, vencimentoDia));
  let due = resolveFirstDueDate(dataInicio, day);
  const today = normalizeDate(new Date());
  while (normalizeDate(due) < today) {
    due = new Date(due.getFullYear(), due.getMonth() + 1, day);
  }
  return due;
}

function formatDateLabel(date?: Date) {
  return date ? DATE_FORMATTER.format(normalizeDate(date)) : '';
}

const paymentOptions: Array<{
  value: 'PIX' | 'CARTAO_CREDITO' | 'BOLETO';
  label: string;
  description: string;
}> = [
  { value: 'PIX', label: 'PIX', description: 'Pagamento mensal via Pix.' },
  { value: 'CARTAO_CREDITO', label: 'Cartão', description: 'Débito ou crédito automático mensal.' },
  { value: 'BOLETO', label: 'Boleto', description: 'Pagamento mensal via boleto.' },
];

const billingStrategyOptions: Array<{
  kind: 'SEPARATE' | 'JOIN_EXISTING_CURRENT_CYCLE' | 'SCHEDULE_NEXT_CYCLE_UNIFICATION';
  label: string;
  description: string;
}> = [
  {
    kind: 'SEPARATE',
    label: 'Cobrança separada',
    description: 'Mantém contrato e cobrança individual desta matrícula.',
  },
  {
    kind: 'JOIN_EXISTING_CURRENT_CYCLE',
    label: 'Incluir em cobrança existente',
    description: 'Disponível quando houver agrupamento compatível para o pagador.',
  },
  {
    kind: 'SCHEDULE_NEXT_CYCLE_UNIFICATION',
    label: 'Unificar no próximo ciclo',
    description: 'Disponível para agrupamentos compatíveis com vigência futura.',
  },
];

type CompatibleBillingGroup = {
  id: string;
  label: string;
  type: 'FAMILY_GROUP' | 'SUBSCRIPTION';
  compatible: boolean;
  blockers: string[];
  valorMensalidadeTotal: number;
};

interface StepFinanceiroProps {
  ctx: WizardContextValue;
}

export function StepFinanceiro({ ctx }: StepFinanceiroProps) {
  const { state, update } = ctx;
  const [dataInicio, setDataInicio] = useState<Date | undefined>(
    state.dataInicio ? parseStoredDate(state.dataInicio) : new Date(),
  );
  const [dataFimContrato, setDataFimContrato] = useState<Date | undefined>(
    state.dataFimContrato ? parseStoredDate(state.dataFimContrato) : undefined,
  );
  const [vencimento, setVencimento] = useState(state.vencimentoDia?.toString() ?? '5');
  const [billingGroups, setBillingGroups] = useState<CompatibleBillingGroup[]>([]);
  const [loadingBillingGroups, setLoadingBillingGroups] = useState(false);
  const { modelos, loading: loadingModelos } = useModelos({ activeOnly: true });
  const activeBillingStrategy = state.billingStrategy?.kind ?? 'SEPARATE';

  const parsedVencimento = Number(vencimento);
  const hasDueDay = vencimento.trim().length > 0;
  const dueDayInvalid = hasDueDay && !isValidDueDay(parsedVencimento);
  const responsavelFinanceiroId = state.aluno?.responsavel?.id ?? state.responsavelFamiliar?.id ?? null;
  const payerType = responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
  const payerId = responsavelFinanceiroId ?? state.aluno?.id ?? null;
  const compatibleBillingGroups = billingGroups.filter(
      (group) =>
        group.compatible &&
        (state.modoMatricula === 'FAMILIAR'
          ? group.type === 'FAMILY_GROUP'
          : group.type === 'SUBSCRIPTION'),
    );
  const selectedFinancialGroupId =
    state.billingStrategy && 'financialGroupId' in state.billingStrategy
      ? state.billingStrategy.financialGroupId
      : null;
  const compatibleBillingGroup =
    compatibleBillingGroups.find((group) => group.id === selectedFinancialGroupId) ??
    compatibleBillingGroups[0] ??
    null;

  const recurringChargeTotal = useMemo(() => {
    if (state.modoMatricula === 'FAMILIAR') {
      return calculateFamilyMonthlyTotal(state);
    }

    if (state.modoTurmas === 'COMBO') {
      return calcularValorLiquidoComBeneficio(state.comboValor ?? 0, state.beneficioSelecionado);
    }

    const value = calcularValorLiquidoComBeneficio(state.planoValor ?? 0, state.beneficioSelecionado);
    return value;
  }, [state]);

  const normalizedStartDate = dataInicio ? normalizeDate(dataInicio) : undefined;
  const normalizedEndDate = dataFimContrato ? normalizeDate(dataFimContrato) : undefined;
  const shouldValidateRecurringEndDate = state.criarCobranca && recurringChargeTotal > 0 && Boolean(normalizedStartDate) && !dueDayInvalid;
  const firstChargeableDueDate = shouldValidateRecurringEndDate && normalizedStartDate
    ? resolveChargeableFirstDueDate(normalizedStartDate, parsedVencimento)
    : undefined;
  const minimumEndDate = normalizedStartDate;
  const contractEndsBeforeStart = Boolean(normalizedStartDate && normalizedEndDate && normalizedEndDate < normalizedStartDate);
  const contractEndsBeforeFirstDue = Boolean(
    firstChargeableDueDate && normalizedEndDate && normalizedEndDate < firstChargeableDueDate,
  );
  const shortContractWarning = contractEndsBeforeFirstDue
    ? `O contrato termina antes da primeira recorrência (${formatDateLabel(firstChargeableDueDate)}). O preview avaliará uma cobrança avulsa em vez de criar uma assinatura inválida.`
    : null;
  const contractEndError = contractEndsBeforeStart
    ? `A data de término precisa ser igual ou posterior a ${formatDateLabel(normalizedStartDate)}.`
    : null;

  useEffect(() => {
    update({
      dataInicio: toIsoDate(dataInicio),
      dataFimContrato: contractEndError ? undefined : toIsoDate(dataFimContrato),
      vencimentoDia: dueDayInvalid || !hasDueDay ? undefined : parsedVencimento,
    });
  }, [contractEndError, dataFimContrato, dataInicio, dueDayInvalid, hasDueDay, parsedVencimento, update, vencimento]);

  useEffect(() => {
    if (!payerId || !state.formaPagamento || dueDayInvalid || !hasDueDay) {
      setBillingGroups([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      payerType,
      payerId,
      formaPagamento: state.formaPagamento,
      vencimentoDia: String(parsedVencimento),
    });
    if (state.contaId) params.set('contaId', state.contaId);

    setLoadingBillingGroups(true);
    fetch(`/api/matriculas/billing-groups?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { data: [] };
        return (await response.json()) as { data?: CompatibleBillingGroup[] };
      })
      .then((payload) => {
        setBillingGroups(Array.isArray(payload.data) ? payload.data : []);
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') setBillingGroups([]);
      })
      .finally(() => setLoadingBillingGroups(false));

    return () => controller.abort();
  }, [dueDayInvalid, hasDueDay, parsedVencimento, payerId, payerType, state.contaId, state.formaPagamento]);

  useEffect(() => {
    if (activeBillingStrategy !== 'SEPARATE' && !compatibleBillingGroup) {
      update({ billingStrategy: { kind: 'SEPARATE' } });
    }
  }, [activeBillingStrategy, compatibleBillingGroup, update]);

  return (
    <SectionCard>
      <StepHeader
        title="Pagamento e Contrato"
        hint="Defina datas do contrato e forma de pagamento."
      />

      <div className="space-y-4">
        {/* Box Datas */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Período do contrato</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600">Data de início</label>
              <DatePicker
                value={dataInicio}
                onChange={setDataInicio}
                placeholder="Selecione a data"
                dateFormat="dd/MM/yyyy"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600">
                Data de fim <span className="text-red-500">*</span>
              </label>
              <DatePicker
                value={dataFimContrato}
                onChange={setDataFimContrato}
                placeholder="Selecione a data"
                dateFormat="dd/MM/yyyy"
                minDate={minimumEndDate}
                invalid={Boolean(contractEndError)}
                describedBy="data-fim-contrato-feedback"
                className={cn(contractEndError && 'border-red-300 text-red-700')}
              />
              <div
                id="data-fim-contrato-feedback"
                aria-live="polite"
                role={contractEndError ? 'alert' : 'status'}
                className={cn(
                  'text-xs leading-relaxed',
                  contractEndError
                    ? 'text-red-700'
                    : shortContractWarning
                      ? 'text-amber-700'
                      : 'text-slate-600',
                )}
              >
                <p>
                  {contractEndError
                    ? contractEndError
                    : shortContractWarning
                      ? shortContractWarning
                      : minimumEndDate
                      ? `Datas válidas a partir de ${formatDateLabel(minimumEndDate)}.`
                      : 'Defina a data de início e o dia do vencimento para liberar datas válidas.'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600">Dia do vencimento</label>
              <Input
                type="number"
                min={1}
                max={28}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                aria-invalid={dueDayInvalid || undefined}
                aria-describedby="vencimento-feedback"
                className={cn(
                  'h-9 rounded-md border-gray-300 text-sm',
                  dueDayInvalid && 'border-red-300 text-red-700 focus-visible:ring-red-500/20',
                )}
              />
              <p
                id="vencimento-feedback"
                className={cn('text-xs', dueDayInvalid ? 'text-red-600' : 'text-slate-500')}
                role={dueDayInvalid ? 'alert' : undefined}
              >
                {dueDayInvalid
                  ? 'Informe um dia entre 1 e 28 para evitar rejeição da cobrança.'
                  : 'Use um dia entre 1 e 28. As datas de término são liberadas conforme esse vencimento.'}
              </p>
            </div>
          </div>
        </div>

        {/* Modelo de contrato */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Modelo do contrato</h3>
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">Modelo</Label>
            <Select
              value={state.modeloId ?? ''}
              onValueChange={(value) => {
                const selected = modelos.find((m) => m.id === value);
                update({ modeloId: value, modeloNome: selected?.nome });
              }}
              disabled={loadingModelos || modelos.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={loadingModelos ? 'Carregando modelos...' : 'Selecione um modelo'}
                />
              </SelectTrigger>
              <SelectContent>
                {modelos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome} {m.versao ? `(v${m.versao})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelos.length === 0 && !loadingModelos && (
              <p className="text-xs text-yellow-700">
                Nenhum modelo encontrado. Importe um PDF em Contratos {'>'} Modelos.
              </p>
            )}
          </div>
        </div>

        {/* Box Forma de Pagamento */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Forma de pagamento</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {paymentOptions.map((option) => {
              const active = state.formaPagamento === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => update({ formaPagamento: option.value })}
                  className={`flex flex-col rounded-lg border p-3 text-left transition ${
                    active
                      ? 'border-transparent bg-violet-200/80 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-sm font-semibold">{option.label}</span>
                  <span className="text-xs text-gray-500 mt-0.5">{option.description}</span>
                </button>
              );
            })}
          </div>
          {state.formaPagamento === 'CARTAO_CREDITO' && (
            <p className="text-xs text-gray-500 mt-3">
              O cliente receberá um link seguro para cadastrar o cartão após a matrícula.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Cobrança</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {billingStrategyOptions.map((option) => {
              const active = activeBillingStrategy === option.kind;
              const disabled =
                option.kind !== 'SEPARATE' &&
                (!compatibleBillingGroup || loadingBillingGroups || !state.dataInicio);
              return (
                <button
                  key={option.kind}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (option.kind === 'SEPARATE') {
                      update({ billingStrategy: { kind: 'SEPARATE' } });
                      return;
                    }
                    if (compatibleBillingGroup && state.dataInicio) {
                      update({
                        billingStrategy: {
                          kind: option.kind,
                          financialGroupId: compatibleBillingGroup.id,
                          effectiveAt: state.dataInicio,
                        },
                      });
                    }
                  }}
                  className={cn(
                    'flex min-h-[92px] flex-col rounded-lg border p-3 text-left transition',
                    active
                      ? 'border-transparent bg-violet-200/80 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100',
                    disabled && 'cursor-not-allowed opacity-60 hover:bg-white',
                  )}
                  aria-pressed={active}
                >
                  <span className="text-sm font-semibold">
                    {state.modoMatricula === 'FAMILIAR' && option.kind === 'SEPARATE'
                      ? 'Criar novo agrupamento familiar'
                      : state.modoMatricula === 'FAMILIAR' &&
                          option.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
                        ? 'Adicionar ao agrupamento familiar existente'
                        : option.label}
                  </span>
                  <span className="mt-1 text-xs leading-relaxed text-gray-500">
                    {disabled && option.kind !== 'SEPARATE'
                      ? loadingBillingGroups
                        ? 'Buscando cobranças compatíveis.'
                        : 'Nenhuma cobrança compatível para este pagador.'
                      : option.description}
                  </span>
                </button>
              );
            })}
          </div>
          {compatibleBillingGroups.length > 1 && (
            <div className="mt-3 space-y-2">
              <Label className="text-xs text-gray-600">
                {state.modoMatricula === 'FAMILIAR'
                  ? 'Agrupamento familiar de destino'
                  : 'Assinatura de destino'}
              </Label>
              <Select
                value={compatibleBillingGroup?.id ?? ''}
                onValueChange={(financialGroupId) => {
                  if (!state.dataInicio) return;
                  update({
                    billingStrategy: {
                      kind:
                        activeBillingStrategy === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
                          ? 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
                          : 'JOIN_EXISTING_CURRENT_CYCLE',
                      financialGroupId,
                      effectiveAt: state.dataInicio,
                    },
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o agrupamento" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleBillingGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.label} · {CURRENCY_FORMATTER.format(group.valorMensalidadeTotal)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {activeBillingStrategy !== 'SEPARATE' && compatibleBillingGroup && (
            <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/60 p-3 text-sm">
              <p className="font-medium text-violet-900">{compatibleBillingGroup.label}</p>
              <p className="mt-1 text-xs text-violet-800">
                Atual: {CURRENCY_FORMATTER.format(compatibleBillingGroup.valorMensalidadeTotal)} ·{' '}
                acréscimo: {CURRENCY_FORMATTER.format(recurringChargeTotal)} ·{' '}
                total previsto:{' '}
                <strong>
                  {CURRENCY_FORMATTER.format(
                    compatibleBillingGroup.valorMensalidadeTotal + recurringChargeTotal,
                  )}
                </strong>
              </p>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
