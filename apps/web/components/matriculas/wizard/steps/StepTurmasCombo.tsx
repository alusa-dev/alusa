import { useEffect, useMemo, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import type { WizardContextValue } from '../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Option {
  value: string;
  label: string;
  descricao?: string;
  capacidade?: number;
  idadeMin?: number;
  idadeMax?: number;
  horaInicio?: string;
  horaFim?: string;
  diasSemana?: string[];
  vagasOcupadas?: number;
  valor?: number; // valor do combo (R$)
  periodicidade?: string; // periodicidade do combo
}

interface StepTurmasComboProps {
  ctx: WizardContextValue;
  contaId?: string;
}

export function StepTurmasCombo({ ctx, contaId }: StepTurmasComboProps) {
  const { state, update } = ctx;
  const [loading, setLoading] = useState(false);
  const [turmas, setTurmas] = useState<Option[]>([]);
  const [combos, setCombos] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contaId) return;
    setLoading(true);
    const controller = new AbortController();

    (async () => {
      try {
        const fetchJson = async (url: string) => {
          const response = await fetch(url, { signal: controller.signal });
          return response.json();
        };

        const [turmasRes, combosRes] = await Promise.all([
          fetchJson(`/api/turmas?contaId=${contaId}&pageSize=200`),
          fetchJson(`/api/combos?contaId=${contaId}`),
        ]);

        const tItems: unknown[] = turmasRes?.data ?? [];
        const cItems: unknown[] = combosRes?.data ?? [];

        setTurmas(
          tItems.map((raw) => {
            const t = raw as Record<string, unknown>;
            return {
              value: String(t.id ?? ''),
              label: String(t.nome ?? 'Turma'),
              idadeMin: typeof t.idadeMin === 'number' ? t.idadeMin : undefined,
              idadeMax: typeof t.idadeMax === 'number' ? t.idadeMax : undefined,
              horaInicio: typeof t.horaInicio === 'string' ? t.horaInicio : undefined,
              horaFim: typeof t.horaFim === 'string' ? t.horaFim : undefined,
              capacidade: typeof t.capacidade === 'number' ? t.capacidade : undefined,
            } satisfies Option;
          }),
        );

        setCombos(
          cItems.map((raw) => {
            const c = raw as Record<string, unknown>;
            return {
              value: String(c.id ?? ''),
              label: String(c.nome ?? 'Combo'),
              descricao: typeof c.descricao === 'string' ? c.descricao : undefined,
              valor: typeof c.valor === 'number' ? c.valor : undefined,
              periodicidade: typeof c.periodicidade === 'string' ? c.periodicidade : undefined,
            } satisfies Option;
          }),
        );
      } catch (e) {
        const name = (e as { name?: string } | null)?.name;
        if (name !== 'AbortError') setError('Falha ao carregar turmas/combos');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [contaId]);

  const modo = state.modoTurmas;

  const toggleTurma = (id: string) => {
    if (state.turmaIds.includes(id)) {
      update({ turmaIds: [], turmaLabel: undefined });
    } else {
      const turma = turmas.find((t) => t.value === id);
      update({
        turmaIds: [id],
        comboId: undefined,
        modoTurmas: 'TURMAS',
        turmaLabel: turma?.label,
      });
    }
  };

  const canContinue = useMemo(() => {
    if (modo === 'COMBO') return !!state.comboId;
    return state.turmaIds.length === 1;
  }, [modo, state.comboId, state.turmaIds]);

  return (
    <SectionCard>
      <StepHeader
        title="Turma ou Combo"
        hint="Escolha uma turma individual ou matricule através de um combo para acelerar a jornada."
      />
      <div className="space-y-6">
        <Tabs
          value={modo}
          onValueChange={(value) => {
            if (value === 'COMBO') {
              update({ modoTurmas: 'COMBO', turmaIds: [] });
              return;
            }
            update({ modoTurmas: 'TURMAS', comboId: undefined });
          }}
        >
          <TabsList
            aria-label="Alternar tipo de matrícula"
            className="h-10 rounded-xl bg-slate-100/80 p-1"
          >
            <TabsTrigger value="TURMAS" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none">
              Selecionar turma
            </TabsTrigger>
            <TabsTrigger value="COMBO" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none">
              Selecionar Combo
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {modo === 'COMBO' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Selecione o combo</p>
            <Select
              value={state.comboId ?? ''}
              onValueChange={(selectedId) => {
                if (!selectedId) {
                  update({
                    comboId: undefined,
                    comboLabel: undefined,
                    comboValor: undefined,
                    comboPeriodicidade: undefined,
                  });
                } else {
                  const combo = combos.find((c) => c.value === selectedId);
                  update({
                    comboId: selectedId,
                    turmaIds: [],
                    comboLabel: combo?.label,
                    comboValor: combo?.valor,
                    comboPeriodicidade: combo?.periodicidade,
                  });
                }
              }}
              disabled={loading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um combo..." />
              </SelectTrigger>
              <SelectContent>
                {combos.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                    {c.valor !== undefined && ` - R$ ${c.valor.toFixed(2)}`}
                    {c.periodicidade && ` (${c.periodicidade})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {combos.length === 0 && !loading && (
              <p className="text-sm text-gray-500">Nenhum combo disponível no momento.</p>
            )}
          </div>
        )}

        {modo === 'TURMAS' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Selecione a turma</p>
            <Select
              value={state.turmaIds[0] ?? ''}
              onValueChange={(selectedId) => {
                if (!selectedId) {
                  update({ turmaIds: [], turmaLabel: undefined });
                } else {
                  toggleTurma(selectedId);
                }
              }}
              disabled={loading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione uma turma..." />
              </SelectTrigger>
              <SelectContent>
                {turmas.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                    {t.horaInicio && t.horaFim && ` (${t.horaInicio} - ${t.horaFim})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {turmas.length === 0 && !loading && (
              <p className="text-sm text-gray-500">Nenhuma turma disponível no momento.</p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div data-step-turmas-can-continue={canContinue} />
      </div>
    </SectionCard>
  );
}
