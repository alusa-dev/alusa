'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  inviteCandidatesResultDTOSchema,
  type InviteCandidateDTO,
  type InviteRoleDTO,
  type InviteTargetDTO,
} from '@/features/users/dtos';
import { Input } from '@/components/ui/input';

type Props = {
  role: Exclude<InviteRoleDTO, 'ADMIN'>;
  onTargetChange: (_target: InviteTargetDTO | null, _candidate?: InviteCandidateDTO) => void;
};

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

function candidateAction(candidate: InviteCandidateDTO) {
  if (candidate.inviteStatus === 'PENDING') return 'Convite pendente. Consulte a aba Convites pendentes.';
  if (candidate.accessStatus === 'ACTIVE') return 'Acesso já ativo nesta escola. Gerencie o usuário na lista.';
  if (!candidate.canInvite && candidate.accessStatus === 'SUSPENDED') {
    return 'A identidade está inativa. Reative o usuário antes de convidar.';
  }
  return 'Acesso suspenso nesta escola. Um novo convite pode reativar o vínculo.';
}

export default function InviteTargetPicker({ role, onTargetChange }: Props) {
  const recordType = role === 'RESPONSAVEL' ? 'RESPONSAVEL' : 'COLABORADOR';
  const inputId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [selected, setSelected] = useState<InviteCandidateDTO | null>(null);
  const [items, setItems] = useState<InviteCandidateDTO[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryCount, setRetryCount] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const manualEmailInputRef = useRef<HTMLInputElement>(null);
  const selectedActionRef = useRef<HTMLButtonElement>(null);
  const focusSelectedRef = useRef(false);
  const restoreSearchFocusRef = useRef(false);
  const focusManualEmailRef = useRef(false);
  const restoreCandidateSearchFocusRef = useRef(false);

  const clearSelection = useCallback(() => {
    setSelected(null);
    onTargetChange(null);
  }, [onTargetChange]);

  useEffect(() => {
    setQuery('');
    setManualMode(false);
    setManualEmail('');
    setSelected(null);
    setItems([]);
    setPage(1);
    setHasMore(false);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setOpen(false);
    setActiveIndex(-1);
    requestGenerationRef.current += 1;
    onTargetChange(null);
    requestRef.current?.abort();
  }, [role, onTargetChange]);

  useEffect(() => {
    if (manualMode && focusManualEmailRef.current) {
      focusManualEmailRef.current = false;
      manualEmailInputRef.current?.focus();
    } else if (!manualMode && restoreCandidateSearchFocusRef.current) {
      restoreCandidateSearchFocusRef.current = false;
      searchInputRef.current?.focus();
    } else if (selected && focusSelectedRef.current) {
      focusSelectedRef.current = false;
      selectedActionRef.current?.focus();
    } else if (!selected && restoreSearchFocusRef.current) {
      restoreSearchFocusRef.current = false;
      searchInputRef.current?.focus();
    }
  }, [manualMode, selected]);

  const fetchCandidates = useCallback(async (requestedPage: number, searchTerm: string, append: boolean, signal: AbortSignal, generation: number) => {
    const params = new URLSearchParams({ recordType, page: String(requestedPage), limit: String(PAGE_SIZE) });
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
    const response = await fetch(`/api/users/invite/candidates?${params.toString()}`, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Não foi possível carregar os cadastros. Tente novamente.');
    const parsed = inviteCandidatesResultDTOSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('A resposta de busca está indisponível. Tente novamente.');
    if (signal.aborted || generation !== requestGenerationRef.current) return;
    setItems((current) => append ? [...current, ...parsed.data.items] : parsed.data.items);
    setPage(parsed.data.page);
    setHasMore(parsed.data.hasMore);
    setActiveIndex(-1);
  }, [recordType]);

  useEffect(() => {
    if (!open || manualMode || selected) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const generation = requestGenerationRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setItems([]);
      void fetchCandidates(1, query, false, controller.signal, generation)
        .catch((cause: unknown) => {
          if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : 'Falha ao buscar cadastros.');
          setItems([]);
          setHasMore(false);
        })
        .finally(() => {
          if (!controller.signal.aborted && generation === requestGenerationRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetchCandidates, manualMode, open, query, retryCount, selected]);

  function choose(candidate: InviteCandidateDTO) {
    if (!candidate.canInvite) return;
    requestGenerationRef.current += 1;
    requestRef.current?.abort();
    focusSelectedRef.current = true;
    setSelected(candidate);
    setLoading(false);
    setOpen(false);
    setQuery('');
    onTargetChange({
      kind: 'EXISTING_RECORD',
      recordType,
      recordId: candidate.recordId,
      role,
    }, candidate);
  }

  function enableManualEmail() {
    requestGenerationRef.current += 1;
    requestRef.current?.abort();
    focusManualEmailRef.current = true;
    setManualMode(true);
    setSelected(null);
    setItems([]);
    setQuery('');
    setOpen(false);
    setManualEmail('');
    setLoading(false);
    setLoadingMore(false);
    onTargetChange(null);
  }

  function returnToCandidateSearch() {
    restoreCandidateSearchFocusRef.current = true;
    setManualMode(false);
    setManualEmail('');
    setQuery('');
    setItems([]);
    setPage(1);
    setHasMore(false);
    setError(null);
    setOpen(false);
    onTargetChange(null);
  }

  function changeManualEmail(value: string) {
    setManualEmail(value);
    const email = value.trim();
    onTargetChange(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? { kind: 'EMAIL', email, role }
      : null);
  }

  function changeSearchQuery(value: string) {
    requestGenerationRef.current += 1;
    requestRef.current?.abort();
    setItems([]);
    setPage(1);
    setHasMore(false);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setActiveIndex(-1);
    setQuery(value);
    setOpen(Boolean(value.trim()));
  }

  function returnToSearch() {
    requestGenerationRef.current += 1;
    requestRef.current?.abort();
    restoreSearchFocusRef.current = true;
    clearSelection();
    setItems([]);
    setPage(1);
    setHasMore(false);
    setError(null);
    setLoading(false);
    setQuery('');
    setOpen(false);
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const generation = requestGenerationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      await fetchCandidates(page + 1, query, true, controller.signal, generation);
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Falha ao carregar mais cadastros.');
      }
    } finally {
      if (!controller.signal.aborted && generation === requestGenerationRef.current) setLoadingMore(false);
    }
  }

  function moveActive(direction: 1 | -1) {
    const available = items.map((item, index) => item.canInvite ? index : -1).filter((index) => index >= 0);
    if (!available.length) return;
    const current = available.indexOf(activeIndex);
    const next = current < 0
      ? (direction === 1 ? available[0] : available[available.length - 1])
      : available[(current + direction + available.length) % available.length];
    setActiveIndex(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      moveActive(-1);
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      const candidate = items[activeIndex];
      if (candidate) choose(candidate);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  if (role === 'RESPONSAVEL') {
    return (
      <div className="space-y-2">
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
          Buscar responsável cadastrado
        </label>
        {selected ? (
          <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-none alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
            <span className="shrink-0 text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{selected.name}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button ref={selectedActionRef} type="button" className="shrink-0 text-xs font-medium text-violet-700 underline" onClick={returnToSearch}>
                Trocar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <Input
                id={inputId}
                ref={searchInputRef}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                aria-label="Buscar responsável cadastrado"
                autoComplete="off"
                value={query}
                onChange={(event) => changeSearchQuery(event.target.value)}
                onFocus={() => setOpen(Boolean(query.trim()))}
                onBlur={() => setOpen(false)}
                onKeyDown={handleKeyDown}
                placeholder="Digite o nome do responsável"
                className="h-10 rounded-md shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {open && (
                <CandidateResults
                  id={listboxId} items={items} loading={loading} error={error} query={query}
                  activeIndex={activeIndex} onChoose={choose} onRetry={() => setRetryCount((count) => count + 1)}
                  hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} recordType={recordType}
                />
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
        {manualMode ? 'E-mail do convidado' : 'Buscar cadastro de colaborador'}
      </label>
      {manualMode ? (
        <>
          <Input
            id={inputId} ref={manualEmailInputRef} type="email" autoComplete="email" value={manualEmail}
            onChange={(event) => changeManualEmail(event.target.value)}
            placeholder="email@exemplo.com" className="h-10 rounded-md shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <button type="button" className="text-xs font-medium text-violet-700 underline" onClick={returnToCandidateSearch}>
            Buscar cadastro existente
          </button>
        </>
      ) : selected ? (
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
          <span className="min-w-0 truncate">{selected.name}</span>
          <button ref={selectedActionRef} type="button" className="shrink-0 text-xs font-medium text-violet-700 underline" onClick={returnToSearch}>
            Trocar
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Input
              id={inputId}
              ref={searchInputRef}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
              aria-label="Buscar cadastro de colaborador"
              autoComplete="off"
              value={query}
              onChange={(event) => changeSearchQuery(event.target.value)}
              onFocus={() => setOpen(Boolean(query.trim()))}
              onBlur={() => setOpen(false)}
              onKeyDown={handleKeyDown}
              placeholder="Digite o nome ou e-mail"
              className="h-10 rounded-md shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {open && (
              <CandidateResults
                id={listboxId} items={items} loading={loading} error={error} query={query}
                activeIndex={activeIndex} onChoose={choose} onRetry={() => setRetryCount((count) => count + 1)}
                hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} recordType={recordType}
              />
            )}
          </div>
          <button type="button" className="text-xs font-medium text-violet-700 underline" onClick={enableManualEmail}>
            Não encontrou? Convidar por e-mail
          </button>
        </>
      )}
    </div>
  );
}

function CandidateResults(props: {
  id: string;
  items: InviteCandidateDTO[];
  loading: boolean;
  error: string | null;
  query: string;
  activeIndex: number;
  onChoose: (_candidate: InviteCandidateDTO) => void;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  recordType: 'COLABORADOR' | 'RESPONSAVEL';
}) {
  const { id, items, loading, error, query, activeIndex, onChoose, onRetry, hasMore, loadingMore, onLoadMore, recordType } = props;
  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-gray-200 bg-white shadow-lg alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-popover)]">
      {loading ? <p role="status" className="px-3 py-3 text-sm text-gray-500">Buscando cadastros…</p> : null}
      {error ? (
        <div className="px-3 py-3 text-sm" role="alert">
          <p>{error}</p><button type="button" className="mt-1 font-medium text-violet-700 underline" onClick={onRetry}>Tentar novamente</button>
        </div>
      ) : null}
      {!loading && !error && !items.length ? (
        <p className="px-3 py-3 text-sm text-gray-500" role="status">
          {query.trim()
            ? recordType === 'RESPONSAVEL'
              ? 'Nenhum responsável disponível para convite.'
              : 'Nenhum colaborador disponível para convite.'
            : recordType === 'RESPONSAVEL'
              ? 'Digite um nome para buscar responsáveis cadastrados.'
              : 'Digite um nome ou e-mail para buscar colaboradores.'}
        </p>
      ) : null}
      <ul id={id} role="listbox" aria-label={recordType === 'RESPONSAVEL' ? 'Responsáveis encontrados' : 'Colaboradores encontrados'} className="max-h-64 overflow-y-auto py-1">
        {items.map((candidate, index) => (
            <li
              key={candidate.recordId}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={!candidate.canInvite}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(candidate)}
              className={`px-3 py-2.5 text-sm ${candidate.canInvite ? 'cursor-pointer hover:bg-violet-50 alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]' : 'cursor-default opacity-80'} ${index === activeIndex ? 'bg-violet-50 outline outline-2 outline-violet-500 alusa-dark:bg-[color:var(--color-bg-card-soft)]' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{candidate.name}</p>
                  <p className="truncate text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                    {candidate.email ?? (recordType === 'RESPONSAVEL' ? 'Contato indisponível; e-mail informado no acesso' : 'Sem e-mail cadastrado; use convite por e-mail')}
                  </p>
                  {recordType === 'RESPONSAVEL' && candidate.students.length > 0 && (
                    <p className="mt-1 text-xs text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                      Alunos: {candidate.students.map((student) => student.name).join(', ')}
                    </p>
                  )}
                  {!candidate.canInvite && <p className="mt-1 text-xs font-medium text-amber-700">{candidateAction(candidate)}</p>}
                  {candidate.canInvite && candidate.accessStatus === 'SUSPENDED' && <p className="mt-1 text-xs text-amber-700">Acesso suspenso nesta escola; o convite solicitará reativação.</p>}
                </div>
                {candidate.inviteStatus === 'PENDING' && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Pendente</span>}
                {candidate.accessStatus === 'ACTIVE' && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">Ativo</span>}
              </div>
            </li>
        ))}
      </ul>
      {hasMore && !loading && !error && (
        <div className="border-t border-gray-100 p-2">
          <button type="button" className="w-full rounded px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}
    </div>
  );
}
