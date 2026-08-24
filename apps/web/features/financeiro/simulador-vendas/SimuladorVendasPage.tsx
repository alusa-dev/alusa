'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InfoCallout } from '@/components/ui/info-callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Loader2 } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { simulateVenda } from './services/simulate-venda';
import type { PaymentSimulationResult, SimulationStatus } from './types';
import { formatCurrency, formatPercent, maskCurrencyInput, parseCurrencyInput } from './utils';

const installmentOptions = Array.from({ length: 21 }, (_, index) => index + 1);

function installmentLabel(value: number): string {
  return value === 1 ? '1 parcela (à vista)' : `Até ${value}x`;
}

function SimulationEmptyState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-accent/10 text-brand-accent">
        <Receipt className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-800">Simule sua cobrança</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        Veja quanto você recebe em uma cobrança no cartão de crédito antes de negociar com seu cliente.
      </p>
    </div>
  );
}

function SimulationLoadingState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-10 text-center text-brand-accent">
      <Loader2 className="mb-4 h-9 w-9 animate-spin" aria-hidden />
      <h3 className="text-base font-semibold">Aguarde</h3>
      <p className="mt-2 text-sm">Estamos carregando a simulação da cobrança.</p>
    </div>
  );
}

function ResultRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className={emphasis ? 'font-semibold text-slate-800' : 'text-slate-500'}>{label}</span>
      <span className={emphasis ? 'font-semibold tabular-nums text-slate-900' : 'tabular-nums text-slate-700'}>{value}</span>
    </div>
  );
}

function SimulationResult({ result }: { result: PaymentSimulationResult }) {
  const installmentValue = result.installmentValue;

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="rounded-xl bg-slate-50 px-3.5 py-2">
        <ResultRow label="Total da cobrança" value={formatCurrency(result.chargeValue)} emphasis />
        <ResultRow label={result.installmentCount === 1 ? '1 parcela' : `${result.installmentCount} parcelas`} value={formatCurrency(installmentValue)} />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-brand-accent/20 bg-brand-accent/[0.04] px-3.5 py-3">
        <p className="text-sm font-semibold text-slate-800">Você recebe (líquido)</p>
        <p className="text-xl font-semibold tabular-nums text-brand-accent">{formatCurrency(result.netValue)}</p>
      </div>

      <div className="rounded-xl border border-slate-200 px-3.5 py-1">
        <ResultRow label="Taxa percentual" value={formatPercent(result.feePercentage)} />
        <ResultRow label="Tarifa de operação" value={result.operationFee == null ? '—' : formatCurrency(result.operationFee)} />
        <ResultRow label="Taxa total" value={formatCurrency(result.feeValue)} emphasis />
      </div>

      <p className="text-[11px] leading-4 text-slate-500">Simulação baseada nas condições atuais da conta Asaas.</p>
    </div>
  );
}

export function SimuladorVendasPage() {
  const [value, setValue] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [status, setStatus] = useState<SimulationStatus>('idle');
  const [result, setResult] = useState<PaymentSimulationResult | null>(null);

  const amount = useMemo(() => parseCurrencyInput(value), [value]);
  const isValid = amount > 0;
  const selectedInstallments = Number(installmentCount);

  const handleSubmit = async () => {
    if (!isValid || status === 'loading') return;

    setStatus('loading');
    setResult(null);
    try {
      const simulation = await simulateVenda({
        value: amount,
        installmentCount: selectedInstallments,
      });
      setResult(simulation);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      pushToast({
        title: 'Não foi possível simular a venda',
        description:
          error instanceof Error && error.message === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
            ? 'A conta financeira ainda não está conectada ao Asaas.'
            : 'Tente novamente em alguns instantes.',
        variant: 'error',
      });
    }
  };

  const handleNewSimulation = () => {
    setStatus('idle');
    setResult(null);
    setValue('');
    setInstallmentCount('1');
  };

  return (
    <div className="alusa-session-panel w-full space-y-5 pb-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span>Cobranças</span>
          <span aria-hidden>/</span>
          <span className="text-brand-accent">Simulador de vendas</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 md:text-[24px]">Simulador de vendas</h1>
      </div>

      <InfoCallout variant="info" size="sm" showIcon>
        Simule valores de cobranças no cartão de crédito antes de criar a cobrança. A simulação não altera seu saldo nem cria uma cobrança no Asaas.
      </InfoCallout>

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="simulation-form-title">
          <div className="max-w-2xl">
            <h2 id="simulation-form-title" className="text-lg font-semibold text-slate-900">Simulador de vendas no cartão</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Simule os valores de cobranças à vista e parceladas no cartão de crédito para entender quanto será recebido.
            </p>

            <div className="mt-7 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="simulation-value">Total a cobrar</Label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-brand-accent focus-within:ring-2 focus-within:ring-brand-accent/20">
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500">R$</span>
                  <Input
                    id="simulation-value"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={value}
                    onChange={(event) => setValue(maskCurrencyInput(event.target.value))}
                    className="h-full rounded-none border-0 text-sm shadow-none focus-visible:ring-0"
                    aria-describedby="simulation-value-help"
                  />
                </div>
                <p id="simulation-value-help" className="text-xs text-slate-500">Informe o valor total que deseja cobrar.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="simulation-installments">Número de parcelas</Label>
                <Select value={installmentCount} onValueChange={setInstallmentCount}>
                  <SelectTrigger id="simulation-installments" aria-label="Número de parcelas">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {installmentOptions.map((option) => (
                      <SelectItem key={option} value={String(option)}>{installmentLabel(option)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">A taxa é calculada conforme as condições atuais da conta Asaas.</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!isValid || status === 'loading'}
                  className="h-10 bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
                >
                  {status === 'loading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  {status === 'loading' ? 'Simulando...' : 'Simular venda'}
                </Button>
                {status === 'success' ? (
                  <Button type="button" variant="outline" onClick={handleNewSimulation} className="h-10 border-brand-accent text-brand-accent hover:bg-brand-accent/5">
                    Nova simulação
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby="simulation-result-title">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <h2 id="simulation-result-title" className="text-lg font-semibold text-slate-900">Resultado da simulação</h2>
              {status === 'error' ? <Info className="h-4 w-4 text-amber-500" aria-label="A simulação apresentou um erro" /> : null}
            </div>
          </div>
          {status === 'loading' ? <SimulationLoadingState /> : result ? <SimulationResult result={result} /> : <SimulationEmptyState />}
        </section>
      </div>
    </div>
  );
}
