'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WizardContextValue } from '../types';

const DEFAULT_TAXA_SUGGESTION = 120;
const QUICK_VALUES = [80, 120, 150];

function formatCurrencyInput(valueInCents: number) {
  const amount = valueInCents / 100;
  return amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrencyDisplay(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function parseCurrency(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface StepTaxaProps {
  ctx: WizardContextValue;
}

export function StepTaxa({ ctx }: StepTaxaProps) {
  const { state, update } = ctx;
  const [isenta, setIsenta] = useState(Boolean(state.taxaIsenta));
  const [valorTexto, setValorTexto] = useState(() => {
    if (state.taxaIsenta) return '0,00';
    const valor = state.taxaMatricula ?? DEFAULT_TAXA_SUGGESTION;
    return formatCurrencyInput(Math.round(valor * 100));
  });
  const [justificativa, setJustificativa] = useState(state.taxaJustificativa ?? '');
  const [formaPagamento, setFormaPagamento] = useState<'PIX' | 'BOLETO' | 'CARTAO'>(
    state.formaPagamentoTaxa === 'CARTAO' || state.formaPagamentoTaxa === 'CARTAO_CREDITO'
      ? 'CARTAO'
      : state.formaPagamentoTaxa === 'BOLETO'
        ? 'BOLETO'
        : 'PIX',
  );

  useEffect(() => {
    const valorNumerico = parseCurrency(valorTexto);
    const deveGerarCobranca = !isenta && valorNumerico > 0;
    const pagoImediatamente = false;

    const formaPagamentoFinal =
      !isenta && valorNumerico > 0
        ? formaPagamento === 'CARTAO'
          ? 'CARTAO_CREDITO'
          : formaPagamento
        : undefined;

    update({
      taxaIsenta: isenta,
      taxaMatricula: isenta ? 0 : valorNumerico,
      taxaJustificativa: isenta ? justificativa.trim() || undefined : undefined,
      formaPagamentoTaxa: formaPagamentoFinal,
      pagarTaxaAgora: pagoImediatamente,
      gerarCobrancaTaxa: deveGerarCobranca,
    });
  }, [isenta, valorTexto, justificativa, formaPagamento, update]);

  useEffect(() => {
    setIsenta(Boolean(state.taxaIsenta));
    if (state.taxaIsenta) {
      setValorTexto('0,00');
    } else if (typeof state.taxaMatricula === 'number') {
      const valorPadrao = formatCurrencyInput(Math.round(state.taxaMatricula * 100));
      setValorTexto(valorPadrao);
    }
    setJustificativa(state.taxaJustificativa ?? '');
  }, [state.taxaIsenta, state.taxaMatricula, state.taxaJustificativa]);

  const valorNumerico = useMemo(() => parseCurrency(valorTexto), [valorTexto]);
  const canContinue = isenta || valorNumerico > 0;

  const handleValorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '');
    if (!digits) {
      setValorTexto('0,00');
      return;
    }
    const cents = Math.min(Number(digits), 9_999_999_999);
    setValorTexto(formatCurrencyInput(cents));
  };

  return (
    <SectionCard>
      <StepHeader
        title="Taxa de matrícula"
        hint="Configure a taxa de adesão. A matrícula poderá ser concluída independentemente do pagamento."
      />

      <div className="space-y-4">
        {/* Box Status da Taxa */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Status da taxa</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={`rounded-lg border p-3 text-left transition ${
                !isenta
                  ? 'border-violet-500 bg-violet-50 text-violet-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setIsenta(false)}
            >
              <span className="text-sm font-semibold">Cobrar taxa</span>
              <span className="block text-xs text-gray-500 mt-0.5">Gera link de pagamento</span>
            </button>
            <button
              type="button"
              className={`rounded-lg border p-3 text-left transition ${
                isenta
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setIsenta(true)}
            >
              <span className="text-sm font-semibold">Isentar taxa</span>
              <span className="block text-xs text-gray-500 mt-0.5">Libera o aluno imediatamente</span>
            </button>
          </div>
        </div>

        {/* Box Valor e Pagamento - só aparece se não isenta */}
        {!isenta && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Valor */}
              <div className="space-y-2">
                <label className="text-xs text-gray-600" htmlFor="taxa-valor">
                  Valor da taxa (R$)
                </label>
                <Input
                  id="taxa-valor"
                  value={valorTexto}
                  onChange={handleValorChange}
                  placeholder="0,00"
                  inputMode="numeric"
                  className="h-9 rounded-md border-gray-300 text-sm"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-500">Sugestões:</span>
                  {QUICK_VALUES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setValorTexto(formatCurrencyInput(Math.round(value * 100)))}
                      className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      {formatCurrencyDisplay(value)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Forma de pagamento */}
              {valorNumerico > 0 && (
                <div className="space-y-2">
                  <label className="text-xs text-gray-600">Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      className={`h-9 rounded-md border text-center transition ${
                        formaPagamento === 'PIX'
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                      onClick={() => setFormaPagamento('PIX')}
                    >
                      <span className="text-sm font-medium">PIX</span>
                    </button>
                    <button
                      type="button"
                      className={`h-9 rounded-md border text-center transition ${
                        formaPagamento === 'BOLETO'
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                      onClick={() => setFormaPagamento('BOLETO')}
                    >
                      <span className="text-sm font-medium">Boleto</span>
                    </button>
                    <button
                      type="button"
                      className={`h-9 rounded-md border text-center transition ${
                        formaPagamento === 'CARTAO'
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                      onClick={() => setFormaPagamento('CARTAO')}
                    >
                      <span className="text-sm font-medium">Cartão</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Box Justificativa - só aparece se isenta */}
        {isenta && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <label className="text-xs text-gray-600 mb-2 block" htmlFor="taxa-justificativa">
              Justificativa da isenção
            </label>
            <Textarea
              id="taxa-justificativa"
              value={justificativa}
              onChange={(event) => setJustificativa(event.target.value)}
              placeholder="Ex.: Bolsista integral, campanha promocional, indicação, etc."
              className="min-h-[80px] resize-none rounded-md border-gray-300 text-sm"
            />
            <p className="text-xs text-gray-400 mt-2">
              Registrada no log da matrícula para auditoria.
            </p>
          </div>
        )}

        <div
          data-step-taxa-can-continue={canContinue}
          data-step-taxa-valor={valorNumerico}
          data-step-taxa-isenta={isenta}
        />
      </div>
    </SectionCard>
  );
}
