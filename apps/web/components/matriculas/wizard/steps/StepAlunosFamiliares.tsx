'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search as SearchIcon, Trash2, Users } from '@/components/icons/icons';
import { cn } from '@/lib/utils';
import type { WizardAlunoFamiliar, WizardContextValue } from '../types';

interface TurmaOption {
  id: string;
  nome: string;
}

interface ComboOption {
  id: string;
  nome: string;
  valor?: number;
  periodicidade?: string;
}

interface AlunoSearchResult {
  id: string;
  nome: string;
  dataNasc?: string | null;
  cpf?: string | null;
  foto?: string | null;
  ativo: boolean;
}

interface StepAlunosFamiliaresProps {
  ctx: WizardContextValue;
  contaId?: string;
}

export function StepAlunosFamiliares({ ctx, contaId }: StepAlunosFamiliaresProps) {
  const { state, update } = ctx;

  const [turmas, setTurmas] = useState<TurmaOption[]>([]);
  const [combos, setCombos] = useState<ComboOption[]>([]);
  const [loadingTurmas, setLoadingTurmas] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AlunoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Carrega turmas/combos da conta
  useEffect(() => {
    if (!contaId) return;
    setLoadingTurmas(true);
    const controller = new AbortController();

    Promise.all([
      fetch(`/api/turmas?contaId=${contaId}&pageSize=200`, { signal: controller.signal }).then(
        (r) => r.json(),
      ),
      fetch(`/api/combos?contaId=${contaId}`, { signal: controller.signal }).then((r) =>
        r.json(),
      ),
    ])
      .then(([turmasRes, combosRes]) => {
        const tItems: unknown[] = turmasRes?.data ?? [];
        const cItems: unknown[] = combosRes?.data ?? [];
        setTurmas(
          tItems.map((raw) => {
            const t = raw as Record<string, unknown>;
            return { id: String(t.id ?? ''), nome: String(t.nome ?? '') };
          }),
        );
        setCombos(
          cItems.map((raw) => {
            const c = raw as Record<string, unknown>;
            return {
              id: String(c.id ?? ''),
              nome: String(c.nome ?? ''),
              valor: typeof c.valor === 'number' ? c.valor : undefined,
              periodicidade: typeof c.periodicidade === 'string' ? c.periodicidade : undefined,
            };
          }),
        );
      })
      .catch(() => {
        // silencioso
      })
      .finally(() => setLoadingTurmas(false));

    return () => controller.abort();
  }, [contaId]);

  // Busca alunos para adicionar
  const buscarAlunos = useCallback(
    (term: string) => {
      if (!contaId || !term.trim()) {
        setSearchResults([]);
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(async () => {
        setSearching(true);
        try {
          const qp = new URLSearchParams({ contaId, q: term.trim() });
          const res = await fetch(`/api/alunos?${qp.toString()}`);
          const json = await res.json();
          const items: unknown[] = json?.items ?? [];
          const jaAdicionados = new Set(state.alunosFamiliares.map((a) => a.id));
          setSearchResults(
            items
              .map((raw) => {
                const a = raw as Record<string, unknown>;
                return {
                  id: String(a.id ?? ''),
                  nome: String(a.nome ?? ''),
                  dataNasc: typeof a.dataNasc === 'string' ? a.dataNasc : null,
                  cpf: typeof a.cpf === 'string' ? a.cpf : null,
                  foto: typeof a.foto === 'string' ? a.foto : null,
                  ativo: a.status !== 'INATIVO',
                };
              })
              .filter((a) => !jaAdicionados.has(a.id)),
          );
        } catch {
          // silencioso
        } finally {
          setSearching(false);
        }
      }, 250);
    },
    [contaId, state.alunosFamiliares],
  );

  useEffect(() => {
    buscarAlunos(searchQuery);
  }, [searchQuery, buscarAlunos]);

  const adicionarAluno = (aluno: AlunoSearchResult) => {
    const novo: WizardAlunoFamiliar = {
      id: aluno.id,
      nome: aluno.nome,
      dataNasc: aluno.dataNasc ?? undefined,
      cpf: aluno.cpf ?? undefined,
      foto: aluno.foto ?? undefined,
      ativo: aluno.ativo,
    };
    update({ alunosFamiliares: [...state.alunosFamiliares, novo] });
    setSearchQuery('');
    setSearchResults([]);
  };

  const removerAluno = (id: string) => {
    update({ alunosFamiliares: state.alunosFamiliares.filter((a) => a.id !== id) });
  };

  const atualizarTurma = (alunoId: string, turmaId: string) => {
    const turma = turmas.find((t) => t.id === turmaId);
    update({
      alunosFamiliares: state.alunosFamiliares.map((a) =>
        a.id === alunoId ? { ...a, turmaId, turmaLabel: turma?.nome } : a,
      ),
    });
  };

  const atualizarCombo = (alunoId: string, comboId: string) => {
    const combo = combos.find((c) => c.id === comboId);
    update({
      alunosFamiliares: state.alunosFamiliares.map((a) =>
        a.id === alunoId
          ? {
              ...a,
              comboId,
              comboLabel: combo?.nome,
              comboValor: combo?.valor,
              comboPeriodicidade: combo?.periodicidade,
            }
          : a,
      ),
    });
  };

  const setModoTurmas = (modo: 'TURMAS' | 'COMBO') => {
    // Limpar seleções de turma/combo ao trocar o modo
    update({
      modoTurmas: modo,
      alunosFamiliares: state.alunosFamiliares.map((a) => ({
        ...a,
        turmaId: undefined,
        turmaLabel: undefined,
        comboId: undefined,
        comboLabel: undefined,
        comboValor: undefined,
        comboPeriodicidade: undefined,
      })),
    });
  };

  const iniciais = (nome: string) =>
    nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');

  return (
    <SectionCard>
      <StepHeader
        title="Alunos da família"
        hint="Adicione os alunos e selecione a turma de cada um."
      />

      <div className="space-y-4">
        {/* Modo turma / combo */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-600">Tipo de vínculo</p>
          <Tabs
            value={state.modoTurmas}
            onValueChange={(v) => setModoTurmas(v as 'TURMAS' | 'COMBO')}
          >
            <TabsList className="h-8">
              <TabsTrigger value="TURMAS" className="text-xs">
                Turma individual
              </TabsTrigger>
              <TabsTrigger value="COMBO" className="text-xs">
                Combo
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Lista de alunos adicionados */}
        {state.alunosFamiliares.length > 0 && (
          <ul className="space-y-2">
            {state.alunosFamiliares.map((aluno) => (
              <li
                key={aluno.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                    {iniciais(aluno.nome)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{aluno.nome}</p>
                    {aluno.ativo === false && (
                      <p className="text-[11px] text-red-500">Aluno inativo</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 items-center gap-2">
                  {state.modoTurmas === 'TURMAS' ? (
                    <Select
                      value={aluno.turmaId ?? ''}
                      onValueChange={(v) => atualizarTurma(aluno.id, v)}
                      disabled={loadingTurmas}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Selecionar turma" />
                      </SelectTrigger>
                      <SelectContent>
                        {turmas.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            {t.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={aluno.comboId ?? ''}
                      onValueChange={(v) => atualizarCombo(aluno.id, v)}
                      disabled={loadingTurmas}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Selecionar combo" />
                      </SelectTrigger>
                      <SelectContent>
                        {combos.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <button
                    type="button"
                    onClick={() => removerAluno(aluno.id)}
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="Remover aluno"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Aviso mínimo de 2 alunos */}
        {state.alunosFamiliares.length < 2 && (
          <div data-testid="alunos-aviso-minimo" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Users className="h-3.5 w-3.5 shrink-0" />
            {state.alunosFamiliares.length === 0
              ? 'Adicione pelo menos 2 alunos para a matrícula familiar.'
              : 'Adicione mais 1 aluno para continuar.'}
          </div>
        )}

        {/* Busca de alunos */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Adicionar aluno</p>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome ou CPF..."
              className="pl-9"
              data-testid="alunos-search"
            />
          </div>

          {searching && <p className="text-xs text-slate-500">Buscando...</p>}

          {!searching && searchResults.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
              {searchResults.slice(0, 8).map((aluno) => (
                <li key={aluno.id}>
                  <button
                    type="button"
                    onClick={() => adicionarAluno(aluno)}
                    disabled={aluno.ativo === false}
                    className={cn(
                      'w-full px-4 py-2.5 text-left hover:bg-violet-50 transition-colors',
                      aluno.ativo === false && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <p className="text-sm font-medium text-slate-800">{aluno.nome}</p>
                    {aluno.cpf && <p className="text-xs text-slate-500">{aluno.cpf}</p>}
                    {aluno.ativo === false && (
                      <p className="text-[11px] text-red-500">Inativo</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
