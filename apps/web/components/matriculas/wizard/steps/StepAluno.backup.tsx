import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Input } from '@/components/ui/input';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { WizardContextValue, WizardAluno } from '../types';

interface Option {
  value: string;
  label: string;
  description?: string;
}

interface StepAlunoProps {
  ctx: WizardContextValue;
  contaId?: string;
}

export function StepAluno({ ctx, contaId }: StepAlunoProps) {
  const { state, update } = ctx;
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [fetchingDetail, setFetchingDetail] = useState(false);
  const [focused, setFocused] = useState(false);

  // Debounce ref
  const debounceRef = useRef<number | null>(null);

  const fetchAlunos = useCallback(
    (term: string) => {
      if (!contaId) return;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(async () => {
        setLoading(true);
        const controller = new AbortController();
        try {
          const qp = new URLSearchParams({ contaId });
          if (term.trim()) qp.set('q', term.trim());
          const res = await fetch(`/api/alunos?${qp.toString()}`, { signal: controller.signal });
          const json = await res.json();
          const items: unknown[] = json?.items ?? [];
          setOptions(
            items.map((raw) => {
              const a = raw as Record<string, unknown>;
              return {
                value: String(a.id ?? ''),
                label: String(a.nome ?? 'Sem nome'),
                description: typeof a.cpf === 'string' ? a.cpf : undefined,
              };
            }),
          );
        } catch (e) {
          const name = (e as { name?: string } | null)?.name;
          if (name !== 'AbortError') setError('Falha ao carregar alunos');
        } finally {
          setLoading(false);
        }
      }, 250);
    },
    [contaId],
  );

  // Carrega inicial
  useEffect(() => {
    fetchAlunos('');
  }, [fetchAlunos]);

  // Quando query muda, buscar no servidor (debounced)
  useEffect(() => {
    fetchAlunos(query);
  }, [query, fetchAlunos]);

  const filtered = useMemo(() => options.slice(0, 25), [options]);

  const canShowDropdown = focused && query.trim().length > 0;

  const selectAluno = useCallback(
    async (o: Option) => {
      setFetchingDetail(true);
      try {
        const r = await fetch(`/api/alunos/${o.value}`);
        const det = await r.json();
        const aluno: WizardAluno = {
          id: o.value,
          nome: det?.nome ?? o.label,
          dataNasc: det?.dataNasc ?? det?.dataNascRaw,
          responsavel: det?.responsavel
            ? { id: det.responsavel.id, nome: det.responsavel.nome }
            : null,
          ativo: det?.status ? det.status === 'ATIVO' : true,
          cpf: typeof det?.cpf === 'string' ? det.cpf : undefined,
          foto: typeof det?.foto === 'string' ? det.foto : undefined,
        };
        update({ aluno });
        setQuery(o.label);
      } catch {
        update({ aluno: { id: o.value, nome: o.label } });
      } finally {
        setFetchingDetail(false);
      }
    },
    [update],
  );

  const menorIdade = useMemo(() => {
    if (!state.aluno?.dataNasc) return false;
    const nasc = new Date(state.aluno.dataNasc);
    const hoje = new Date();
    const idade =
      hoje.getFullYear() -
      nasc.getFullYear() -
      (hoje < new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate()) ? 1 : 0);
    return idade < 18;
  }, [state.aluno]);

  // Validação de possibilidade de avançar exposta via data-attributes (footer usa wizard.state)
  const canContinue =
    !!state.aluno && (!menorIdade || !!state.aluno.responsavel) && state.aluno.ativo !== false;

  const initials = useMemo(() => {
    if (!state.aluno?.nome) return '';
    return state.aluno.nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
  }, [state.aluno?.nome]);

  // Utilitário para mascarar CPF (somente se 11 dígitos)
  const maskCpf = useCallback((raw?: string) => {
    if (!raw) return undefined;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return raw; // fallback caso já venha formatado ou incompleto
  }, []);

  return (
    <SectionCard>
      <StepHeader
        title="Selecione o Aluno"
        hint="Busque pelo nome ou CPF para localizar alguém já cadastrado na escola."
      />
      <div className="space-y-6">
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFocused(false);
              }
            }}
            placeholder="Ex.: Maria Silva ou 123.456.789-00"
            className="h-10 rounded-md border-gray-300 bg-white pl-11 text-sm text-gray-900 placeholder:text-gray-400"
            disabled={loading}
            aria-autocomplete="list"
            aria-expanded={canShowDropdown}
            aria-controls="aluno-suggestions"
          />
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          {canShowDropdown && (
            <div
              id="aluno-suggestions"
              role="listbox"
              className="absolute z-40 mt-2 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
              data-testid="aluno-suggestions"
            >
              {filtered.length === 0 && !loading && (
                <div className="select-none px-4 py-3 text-sm text-gray-500">
                  Nenhum aluno encontrado
                </div>
              )}
              {loading && (
                <div className="select-none px-4 py-3 text-sm text-gray-500">Carregando...</div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  role="option"
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectAluno(o);
                    setFocused(false);
                  }}
                  className="cursor-pointer w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{o.label}</span>
                    {o.description && (
                      <span className="text-xs text-gray-500">{maskCpf(o.description)}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {state.aluno && (
          <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 relative">
            {state.aluno.foto ? (
              <img
                src={state.aluno.foto}
                alt={state.aluno.nome}
                className="h-12 w-12 rounded-full object-cover ring-2 ring-[#4f2298]/30"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4f2298]/15 text-sm font-semibold text-[#4f2298]">
                {initials || 'A'}
              </div>
            )}
            <div className="flex-1 space-y-1 text-sm text-gray-700">
              <p className="text-base font-semibold text-gray-900">{state.aluno.nome}</p>
              {state.aluno.cpf && (
                <p className="text-xs font-medium text-gray-600 tracking-wide">
                  CPF: {maskCpf(state.aluno.cpf)}
                </p>
              )}
              {state.aluno.responsavel && (
                <p className="text-xs text-gray-600">
                  Responsável:{' '}
                  <span className="font-medium text-gray-800">{state.aluno.responsavel.nome}</span>
                </p>
              )}
              {state.aluno.ativo === false && (
                <p className="text-xs font-semibold text-red-600">Aluno inativo</p>
              )}
              {!state.aluno.responsavel && menorIdade && (
                <p className="text-xs font-semibold text-red-600">
                  Necessário responsável (menor de idade)
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => update({ aluno: undefined })}
              className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/60"
              aria-label="Remover aluno selecionado"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
        )}

        {/* Footer global controla o avanço; expomos estado via data attrs para testes se necessário */}
        <div data-step-aluno-can-continue={canContinue} data-step-aluno-loading={fetchingDetail} />
      </div>
    </SectionCard>
  );
}
