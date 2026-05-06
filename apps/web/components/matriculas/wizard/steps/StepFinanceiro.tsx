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
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');

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
  const { modelos, loading: loadingModelos } = useModelos({ activeOnly: true });

  const parsedVencimento = Number(vencimento);
  const hasDueDay = vencimento.trim().length > 0;
  const dueDayInvalid = hasDueDay && !isValidDueDay(parsedVencimento);

  const recurringChargeTotal = useMemo(() => {
    if (state.modoTurmas === 'COMBO') {
      if (state.modoMatricula === 'FAMILIAR') {
        return state.alunosFamiliares.reduce(
          (total, aluno) =>
            total + calcularValorLiquidoComBeneficio(aluno.comboValor ?? 0, state.beneficioSelecionado),
          0,
        );
      }

      return calcularValorLiquidoComBeneficio(state.comboValor ?? 0, state.beneficioSelecionado);
    }

    return calcularValorLiquidoComBeneficio(state.planoValor ?? 0, state.beneficioSelecionado);
  }, [state.alunosFamiliares, state.beneficioSelecionado, state.comboValor, state.modoMatricula, state.modoTurmas, state.planoValor]);

  const normalizedStartDate = dataInicio ? normalizeDate(dataInicio) : undefined;
  const normalizedEndDate = dataFimContrato ? normalizeDate(dataFimContrato) : undefined;
  const shouldValidateRecurringEndDate = state.criarCobranca && recurringChargeTotal > 0 && Boolean(normalizedStartDate) && !dueDayInvalid;
  const firstChargeableDueDate = shouldValidateRecurringEndDate && normalizedStartDate
    ? resolveChargeableFirstDueDate(normalizedStartDate, parsedVencimento)
    : undefined;
  const minimumEndDate = firstChargeableDueDate ?? normalizedStartDate;
  const contractEndsBeforeStart = Boolean(normalizedStartDate && normalizedEndDate && normalizedEndDate < normalizedStartDate);
  const contractEndsBeforeFirstDue = Boolean(
    firstChargeableDueDate && normalizedEndDate && normalizedEndDate < firstChargeableDueDate,
  );
  const contractEndError = contractEndsBeforeStart
    ? `A data de término precisa ser igual ou posterior a ${formatDateLabel(normalizedStartDate)}.`
    : contractEndsBeforeFirstDue
      ? `Com vencimento no dia ${parsedVencimento}, a primeira cobrança válida será em ${formatDateLabel(firstChargeableDueDate)}. Escolha essa data ou uma posterior.`
      : null;

  useEffect(() => {
    update({
      dataInicio: toIsoDate(dataInicio),
      dataFimContrato: contractEndError ? undefined : toIsoDate(dataFimContrato),
      vencimentoDia: dueDayInvalid || !hasDueDay ? undefined : parsedVencimento,
    });
  }, [contractEndError, dataFimContrato, dataInicio, dueDayInvalid, hasDueDay, parsedVencimento, update, vencimento]);

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
                className={cn('text-xs leading-relaxed', contractEndError ? 'text-red-700' : 'text-slate-600')}
              >
                <p>
                  {contractEndError
                    ? contractEndError
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
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
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
      </div>
    </SectionCard>
  );
}
