import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { WizardContextValue } from '../types';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StepJurosMultaProps {
  ctx: WizardContextValue;
}

export function StepJurosMulta({ ctx }: StepJurosMultaProps) {
  const { state, update } = ctx;

  // Estados locais para inputs
  const [multaPercentual, setMultaPercentual] = useState(state.multaPercentual?.toString() ?? '');
  const [jurosMensal, setJurosMensal] = useState(state.jurosMensal?.toString() ?? '');
  const [descontoAntecipado, setDescontoAntecipado] = useState(
    state.descontoAntecipado?.toString() ?? '',
  );
  const [descontoTipo, setDescontoTipo] = useState<'FIXED' | 'PERCENTAGE'>(state.descontoTipo === 'FIXED' ? 'FIXED' : 'PERCENTAGE');
  const [prazoDesconto, setPrazoDesconto] = useState(state.prazoDesconto?.toString() ?? '0');

  // Sincroniza estado local com contexto global
  useEffect(() => {
    const parsedMulta = Number(multaPercentual.replace(',', '.')) || undefined;
    const parsedJuros = Number(jurosMensal.replace(',', '.')) || undefined;
    const parsedDesconto = Number(descontoAntecipado.replace(',', '.')) || undefined;
    const parsedPrazo = Number(prazoDesconto) || 0;

    update({
      multaPercentual: parsedMulta,
      jurosMensal: parsedJuros,
      descontoAntecipado: parsedDesconto,
      descontoTipo,
      prazoDesconto: parsedPrazo,
    });
  }, [multaPercentual, jurosMensal, descontoAntecipado, descontoTipo, prazoDesconto, update]);

  return (
    <SectionCard>
      <StepHeader
        title="Juros e Multa"
        hint="Configure multa, juros e desconto por antecipação. Campos opcionais."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Box Multa */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Multa por atraso</h3>
          <p className="text-xs text-gray-500 mb-3">Aplicada no dia seguinte ao vencimento</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={multaPercentual}
              onChange={(e) => setMultaPercentual(e.target.value)}
              placeholder="Ex: 2.0"
              className="h-9 w-24 rounded-md border-gray-300 text-sm"
            />
            <span className="text-sm text-gray-600">%</span>
            <span className="text-xs text-gray-400 ml-auto">máx. 10%</span>
          </div>
        </div>

        {/* Box Juros */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Juros mensais</h3>
          <p className="text-xs text-gray-500 mb-3">Aplicados proporcionalmente aos dias em atraso</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={jurosMensal}
              onChange={(e) => setJurosMensal(e.target.value)}
              placeholder="Ex: 1.0"
              className="h-9 w-24 rounded-md border-gray-300 text-sm"
            />
            <span className="text-sm text-gray-600">% a.m.</span>
            <span className="text-xs text-gray-400 ml-auto">máx. 5%</span>
          </div>
        </div>

        {/* Box Desconto - ocupa 2 colunas */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 sm:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Desconto por antecipação</h3>
          <p className="text-xs text-gray-500 mb-3">Incentivo para pagamento antes do vencimento</p>
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
                className="h-9 w-24 rounded-md border-gray-300 text-sm"
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
                className="h-9 w-20 rounded-md border-gray-300 text-sm"
              />
            </div>
            <span className="text-xs text-gray-400 pb-2">0 = válido até o vencimento</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-4">
        Deixe os campos vazios para não aplicar estas configurações.
      </p>
    </SectionCard>
  );
}
