import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Modalidade, Sala } from '@/components/turmas/types';

type CacheEntry<T> = {
  data: T;
  ts: number;
};

const TTL = 60_000;
const modalidadesCache = new Map<string, CacheEntry<Modalidade[]>>();
const salasCache = new Map<string, CacheEntry<Sala[]>>();

function readCache<T>(store: Map<string, CacheEntry<T>>, contaId: string | undefined) {
  if (!contaId) return null;
  const entry = store.get(contaId);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) {
    store.delete(contaId);
    return null;
  }
  return entry.data;
}

function writeCache<T>(store: Map<string, CacheEntry<T>>, contaId: string, data: T) {
  store.set(contaId, { data, ts: Date.now() });
}

async function fetchCollection<T>(url: string): Promise<T[]> {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const json = await res.json().catch(() => ({ data: [] }));
  return (json?.data || []) as T[];
}

export function invalidateTurmaLookupsCache(contaId?: string) {
  if (contaId) {
    modalidadesCache.delete(contaId);
    salasCache.delete(contaId);
    return;
  }
  modalidadesCache.clear();
  salasCache.clear();
}

interface UseTurmaLookupsOptions {
  onLoaded?: (_modalidades: Modalidade[], _salas: Sala[]) => void;
}

interface UseTurmaLookupsReturn {
  modalidades: Modalidade[];
  salas: Sala[];
  loading: boolean;
  reloadModalidades: () => Promise<Modalidade[]>;
  reloadSalas: () => Promise<Sala[]>;
}

export function useTurmaLookups(
  contaId: string | undefined,
  options?: UseTurmaLookupsOptions,
): UseTurmaLookupsReturn {
  const [modalidadesState, setModalidadesState] = useState<Modalidade[] | null>(() =>
    readCache(modalidadesCache, contaId),
  );
  const [salasState, setSalasState] = useState<Sala[] | null>(() => readCache(salasCache, contaId));
  const [loading, setLoading] = useState(
    () => !readCache(modalidadesCache, contaId) || !readCache(salasCache, contaId),
  );
  const contaRef = useRef(contaId);

  const onLoadedCallback = options?.onLoaded;
  const notifyLoaded = useCallback(
    (mods: Modalidade[], rooms: Sala[]) => {
      onLoadedCallback?.(mods, rooms);
    },
    [onLoadedCallback],
  );

  const loadAll = useCallback(
    async (id: string) => {
      setLoading(true);
      const [mods, rooms] = await Promise.all([
        fetchCollection<Modalidade>(`/api/modalidades?contaId=${id}`),
        fetchCollection<Sala>(`/api/salas?contaId=${id}`),
      ]);
      if (contaRef.current !== id) {
        return { modalidades: mods, salas: rooms };
      }
      writeCache(modalidadesCache, id, mods);
      writeCache(salasCache, id, rooms);
      setModalidadesState(mods);
      setSalasState(rooms);
      setLoading(false);
      notifyLoaded(mods, rooms);
      return { modalidades: mods, salas: rooms };
    },
    [notifyLoaded],
  );

  const reloadModalidades = useCallback(async () => {
    if (!contaRef.current) return [] as Modalidade[];
    const id = contaRef.current;
    modalidadesCache.delete(id);
    const { modalidades: mods, salas: rooms } = await loadAll(id);
    // loadAll already handled notifyLoaded and state updates when id matches
    if (contaRef.current !== id) {
      notifyLoaded(mods, rooms);
    }
    return mods;
  }, [loadAll, notifyLoaded]);

  const reloadSalas = useCallback(async () => {
    if (!contaRef.current) return [] as Sala[];
    const id = contaRef.current;
    salasCache.delete(id);
    const { modalidades: mods, salas: rooms } = await loadAll(id);
    if (contaRef.current !== id) {
      notifyLoaded(mods, rooms);
    }
    return rooms;
  }, [loadAll, notifyLoaded]);

  useEffect(() => {
    contaRef.current = contaId;
    if (!contaId) {
      setModalidadesState([]);
      setSalasState([]);
      setLoading(false);
      return;
    }
    const cachedModalidades = readCache(modalidadesCache, contaId);
    const cachedSalas = readCache(salasCache, contaId);
    if (cachedModalidades) setModalidadesState(cachedModalidades);
    if (cachedSalas) setSalasState(cachedSalas);
    if (!cachedModalidades || !cachedSalas) {
      loadAll(contaId).catch(() => {
        if (contaRef.current === contaId) setLoading(false);
      });
    }
  }, [contaId, loadAll]);

  useEffect(() => {
    if (!contaId) return;
    const handleModalidadesChanged = () => {
      reloadModalidades().catch(() => undefined);
    };
    const handleSalasChanged = () => {
      reloadSalas().catch(() => undefined);
    };
    window.addEventListener('modalidades:changed', handleModalidadesChanged);
    window.addEventListener('salas:changed', handleSalasChanged);
    return () => {
      window.removeEventListener('modalidades:changed', handleModalidadesChanged);
      window.removeEventListener('salas:changed', handleSalasChanged);
    };
  }, [contaId, reloadModalidades, reloadSalas]);

  return useMemo(
    () => ({
      modalidades: modalidadesState ?? [],
      salas: salasState ?? [],
      loading,
      reloadModalidades,
      reloadSalas,
    }),
    [loading, modalidadesState, reloadModalidades, reloadSalas, salasState],
  );
}
