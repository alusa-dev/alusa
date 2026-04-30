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
import { useModelos } from '@/features/contratos/hooks/use-modelos';
import type { WizardContextValue } from '../types';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { calcularValorLiquidoComBeneficio } from '../beneficios';

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
    state.dataInicio ? new Date(state.dataInicio) : new Date(),
  );
  const [dataFimContrato, setDataFimContrato] = useState<Date | undefined>(
    state.dataFimContrato ? new Date(state.dataFimContrato) : undefined,
  );
  const [vencimento, setVencimento] = useState(state.vencimentoDia?.toString() ?? '5');
  const { modelos, loading: loadingModelos } = useModelos({ activeOnly: true });

  const valorMensalidade = state.modoTurmas === 'COMBO'
    ? (state.comboValor ?? 0)
    : (state.planoValor ?? 0);
  const valorMensalidadeLiquido = calcularValorLiquidoComBeneficio(
    valorMensalidade,
    state.beneficioSelecionado,
  );
  const formatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    [],
  );

  useEffect(() => {
    const parsedVencimento = Number(vencimento);
    update({
      dataInicio: dataInicio ? dataInicio.toISOString().slice(0, 10) : undefined,
      dataFimContrato: dataFimContrato ? dataFimContrato.toISOString().slice(0, 10) : undefined,
      vencimentoDia: Number.isFinite(parsedVencimento) ? parsedVencimento : 5,
    });
  }, [dataInicio, dataFimContrato, vencimento, update]);

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
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600">Dia do vencimento</label>
              <Input
                type="number"
                min={1}
                max={28}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="h-9 rounded-md border-gray-300 text-sm"
              />
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

        {/* Box Resumo */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-600">
                {state.modoTurmas === 'COMBO' ? 'Combo selecionado' : 'Plano selecionado'}
              </p>
              <p className="text-sm font-medium text-gray-900">
                {state.modoTurmas === 'COMBO' ? state.comboLabel : state.planoLabel || 'Nenhum'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-600">Mensalidade</p>
              <p className="text-lg font-semibold text-violet-700">
                {formatter.format(valorMensalidadeLiquido)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
