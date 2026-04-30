import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Professor } from '@/components/turmas/types';

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const TTL = 60_000;
const professoresCache = new Map<string, CacheEntry<Professor[]>>();

function readCache(contaId: string | undefined) {
  if (!contaId) return null;
  const entry = professoresCache.get(contaId);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) {
    professoresCache.delete(contaId);
    return null;
  }
  return entry.data;
}

function writeCache(contaId: string, data: Professor[]) {
  professoresCache.set(contaId, { data, ts: Date.now() });
}

function formatTelefone(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return raw;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

async function fetchProfessores(contaId: string): Promise<Professor[]> {
  const qs = new URLSearchParams({
    contaId,
    cargo: 'PROFESSOR',
    status: 'ATIVO',
    pageSize: '200',
  }).toString();
  const res = await fetch(`/api/colaboradores?${qs}`, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) {
    console.error('[useProfessoresLookup] falha ao carregar colaboradores professores', {
      contaId,
      status: res?.status,
    });
    return [];
  }
  const json = await res.json().catch(() => ({ items: [] }));
  const items = Array.isArray(json?.items) ? (json.items as Record<string, unknown>[]) : [];
  const mapped = items.reduce<Map<string, Professor>>((acc, item) => {
    const rawId = item?.id;
    const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined;
    if (!id) return acc;
    const cargo = typeof item?.cargo === 'string' ? item.cargo.toUpperCase() : '';
    if (cargo !== 'PROFESSOR') return acc;
    const rawNome = typeof item?.nome === 'string' ? item.nome : '';
    const rawNomeSocial = typeof item?.nomeSocial === 'string' ? item.nomeSocial : '';
    const displayNome = rawNomeSocial.trim() || rawNome.trim() || 'Professor sem nome';
    const email = typeof item?.email === 'string' ? item.email : undefined;
    const telefone = formatTelefone(item?.telefone1);
    const foto = typeof item?.foto === 'string' ? item.foto : undefined;
    const especialidadeRaw = typeof item?.especialidade === 'string' ? item.especialidade : '';
    const especialidades = especialidadeRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const status = typeof item?.status === 'string' ? item.status : undefined;
    acc.set(id, {
      id,
      nome: displayNome,
      nomeLegal: rawNome.trim() || undefined,
      email,
      telefone,
      foto: foto ?? null,
      especialidades,
      status,
    });
    return acc;
  }, new Map<string, Professor>());

  return Array.from(mapped.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
  );
}

export function invalidateProfessoresLookupCache(contaId?: string) {
  if (contaId) {
    professoresCache.delete(contaId);
    return;
  }
  professoresCache.clear();
}

interface UseProfessoresLookupReturn {
  professores: Professor[];
  loading: boolean;
  reloadProfessores: () => Promise<Professor[]>;
}

export function useProfessoresLookup(contaId: string | undefined): UseProfessoresLookupReturn {
  const [professoresState, setProfessoresState] = useState<Professor[] | null>(() =>
    readCache(contaId),
  );
  const [loading, setLoading] = useState(() => !readCache(contaId));
  const contaRef = useRef(contaId);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    const data = await fetchProfessores(id);
    if (contaRef.current !== id) {
      return data;
    }
    writeCache(id, data);
    setProfessoresState(data);
    setLoading(false);
    // Estratégia de re-tentativa automática: se vazio nas primeiras tentativas, refaz
    if (data.length === 0 && retryRef.current < 5) {
      retryRef.current += 1;
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        if (contaRef.current === id) {
          professoresCache.delete(id);
          load(id).catch(() => undefined);
        }
      }, 1200 * retryRef.current); // backoff linear simples
    }
    return data;
  }, []);

  const reloadProfessores = useCallback(async () => {
    if (!contaRef.current) return [] as Professor[];
    const id = contaRef.current;
    professoresCache.delete(id);
    return load(id);
  }, [load]);

  useEffect(() => {
    contaRef.current = contaId;
    if (!contaId) {
      setProfessoresState([]);
      setLoading(false);
      return;
    }
    retryRef.current = 0;
    const cached = readCache(contaId);
    if (cached) {
      setProfessoresState(cached);
      setLoading(false);
      return;
    }
    load(contaId).catch(() => {
      if (contaRef.current === contaId) setLoading(false);
    });
  }, [contaId, load]);

  useEffect(() => {
    if (!contaId) return;
    const handler = () => {
      reloadProfessores().catch(() => undefined);
    };
    const focusHandler = () => {
      reloadProfessores().catch(() => undefined);
    };
    window.addEventListener('professores:changed', handler);
    window.addEventListener('colaboradores:changed', handler);
    window.addEventListener('focus', focusHandler);
    return () => {
      window.removeEventListener('professores:changed', handler);
      window.removeEventListener('colaboradores:changed', handler);
      window.removeEventListener('focus', focusHandler);
    };
  }, [contaId, reloadProfessores]);

  // Cleanup para timers
  useEffect(
    () => () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  return useMemo(
    () => ({
      professores: professoresState ?? [],
      loading,
      reloadProfessores,
    }),
    [loading, professoresState, reloadProfessores],
  );
}
