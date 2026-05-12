'use client';

import React from 'react';
import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '../constants';
import type { GlobalSearchGroupDTO } from '../dtos';
import { fetchGlobalSearch } from '../services/search-service';

type GlobalSearchResultsPageProps = {
  initialQuery: string;
};

export function GlobalSearchResultsPage({ initialQuery }: GlobalSearchResultsPageProps): JSX.Element {
  const query = initialQuery.trim();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GlobalSearchGroupDTO[]>([]);

  useEffect(() => {
    if (query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchGlobalSearch(query, controller.signal)
      .then((result) => {
        setGroups(result.groups);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar os resultados.');
        setGroups([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [query]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="pb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-slate-900">Resultados da busca</h1>
        <p className="mt-1 text-sm text-slate-500">
          {query.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH
            ? `Resultados para "${query}"`
            : 'Digite pelo menos 2 caracteres para buscar'}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-3">
        {loading ? <div className="text-sm text-slate-500">Carregando...</div> : null}
        {!loading && error ? <div className="text-sm text-slate-500">{error}</div> : null}
        {!loading && !error && query.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH && groups.length === 0 ? (
          <div className="text-sm text-slate-500">Nenhum resultado encontrado</div>
        ) : null}

        {!loading && !error && groups.length > 0 ? (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <Link
                      key={`${group.key}-${item.id}`}
                      href={item.href}
                      className="block rounded-3xl border border-slate-200/80 bg-white px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="text-sm font-medium text-slate-900">{item.title}</div>
                      {item.description ? (
                        <div className="mt-1 text-xs text-slate-500">{item.description}</div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}