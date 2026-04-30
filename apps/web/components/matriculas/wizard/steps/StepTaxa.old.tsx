'use client';

import { useEffect, useMemo, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { WizardContextValue } from '../types';

const DEFAULT_TAXA_SUGGESTION = 120;
const QUICK_VALUES = [80, 120, 150];

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
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  const [justificativa, setJustificativa] = useState(state.taxaJustificativa ?? '');
  const [gerarCobrancaImediata, setGerarCobrancaImediata] = useState(
    Boolean(state.gerarCobrancaTaxa) && !state.taxaIsenta,
  );

  useEffect(() => {
    const valorNumerico = parseCurrency(valorTexto);
    update({
      taxaIsenta: isenta,
      taxaMatricula: isenta ? 0 : valorNumerico,
      taxaJustificativa: isenta ? justificativa.trim() || undefined : undefined,
      gerarCobrancaTaxa: !isenta && gerarCobrancaImediata,
    });
  }, [isenta, valorTexto, justificativa, gerarCobrancaImediata, update]);

  useEffect(() => {
    setIsenta(Boolean(state.taxaIsenta));
    if (state.taxaIsenta) {
      setValorTexto('0,00');
      setGerarCobrancaImediata(false);
    } else if (typeof state.taxaMatricula === 'number') {
      setValorTexto(
        state.taxaMatricula.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );
      setGerarCobrancaImediata(Boolean(state.gerarCobrancaTaxa));
    }
    setJustificativa(state.taxaJustificativa ?? '');
  }, [state.taxaIsenta, state.taxaMatricula, state.taxaJustificativa, state.gerarCobrancaTaxa]);

  const valorNumerico = useMemo(() => parseCurrency(valorTexto), [valorTexto]);
  const canContinue = isenta || valorNumerico > 0;

  return (
    <SectionCard>
      <StepHeader
        title="Taxa de matrícula"
        hint="Defina como será cobrada a taxa de adesão do aluno ou informe a isenção, se aplicada."
      />
      <div className="space-y-6 text-sm text-gray-700">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700">Status da taxa</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 ${
                  !isenta
                    ? 'border-brand-accent bg-brand-accent/10 text-brand-accent shadow-sm'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-brand-accent/40 hover:bg-brand-accent/5'
                }`}
                onClick={() => setIsenta(false)}
              >
                <span className="block text-sm font-semibold">Cobrar taxa</span>
                <span className="mt-1 block text-xs text-current/80">
                  Gerar cobrança PIX com validade de 24h.
                </span>
              </button>
              <button
                type="button"
                className={`rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 ${
                  isenta
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-400/60 hover:bg-emerald-50/50'
                }`}
                onClick={() => setIsenta(true)}
              >
                <span className="block text-sm font-semibold">Isentar taxa</span>
                <span className="mt-1 block text-xs text-current/80">
                  Libera o aluno imediatamente. Registre a justificativa.
                </span>
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Resumo</p>
            <p className="mt-3 text-sm text-gray-600">
              Status: <strong>{isenta ? 'Isento' : 'Cobrança automática via PIX'}</strong>
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Valor considerado:{' '}
              <strong>{formatCurrencyDisplay(isenta ? 0 : valorNumerico)}</strong>
            </p>
            <p className="mt-2 text-xs text-gray-500">
              O link de checkout só será gerado se você optar por criar a cobrança agora.
            </p>
          </div>
        </div>

        {!isenta && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="taxa-valor">
                Valor da taxa (R$)
              </label>
              <Input
                id="taxa-valor"
                value={valorTexto}
                onChange={(event) => setValorTexto(event.target.value)}
                placeholder="0,00"
                className="h-11 rounded-lg border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:border-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/30"
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-gray-500">Sugestões rápidas:</span>
              {QUICK_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setValorTexto(
                      value.toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    )
                  }
                  className="rounded-full border border-brand-accent/30 px-3 py-1 font-medium text-brand-accent transition hover:border-brand-accent hover:bg-brand-accent/10"
                >
                  {formatCurrencyDisplay(value)}
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="taxa-gerar-cobranca"
                  checked={gerarCobrancaImediata}
                  onCheckedChange={(checked) => setGerarCobrancaImediata(checked === true)}
                  disabled={isenta}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="taxa-gerar-cobranca"
                    className="text-sm font-medium text-gray-700"
                  >
                    Gerar cobrança imediatamente
                  </Label>
                  <p className="text-xs text-gray-500">
                    Quando desmarcado, a cobrança ficará pendente e só será gerada após validar o
                    cartão do responsável financeiro.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {isenta && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700" htmlFor="taxa-justificativa">
              Justificativa da isenção
            </label>
            <Textarea
              id="taxa-justificativa"
              value={justificativa}
              onChange={(event) => setJustificativa(event.target.value)}
              placeholder="Ex.: Bolsista integral, campanha promocional, indicação, etc."
              className="min-h-[110px] resize-none rounded-lg border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-200"
            />
            <p className="text-xs text-gray-500">
              A justificativa fica registrada no log da matrícula para auditoria futura.
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
