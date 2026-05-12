'use client';

import React, { useId, useMemo, useRef, type JSX } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { usePathname, useRouter } from 'next/navigation';

import { Search } from '@/components/icons/icons';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '../constants';
import type { GlobalSearchItemDTO } from '../dtos';
import { useGlobalSearch } from '../hooks/use-global-search';

type HeaderSearchProps = {
  role?: string | null;
};

export function HeaderSearch({ role = null }: HeaderSearchProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { query, setQuery, open, setOpen, loading, error, groups, items, selectItem } = useGlobalSearch({
    role,
  });

  React.useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [pathname, setOpen, setQuery]);

  const shouldShowPopover = open && (loading || groups.length > 0 || Boolean(error));
  const showPrompt = !loading && !error && items.length === 0 && query.trim().length > 0;

  const emptyMessage = useMemo(() => {
    if (!query.trim()) return 'Nenhum atalho disponível';
    if (query.trim().length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) return 'Digite pelo menos 2 caracteres';
    return 'Nenhum resultado encontrado';
  }, [query]);

  const handleSelect = (item: GlobalSearchItemDTO) => {
    selectItem(item);
    router.push(item.href);
  };

  const handleViewAll = () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) return;
    setOpen(false);
    router.push(`/busca?q=${encodeURIComponent(trimmedQuery)}`);
  };

  return (
    <Popover open={shouldShowPopover} onOpenChange={setOpen}>
      <CommandPrimitive loop shouldFilter={false} className="w-full">
        <PopoverAnchor asChild>
          <div className="relative w-full max-w-[460px]">
            <label htmlFor={searchId} className="sr-only">
              Pesquisar
            </label>
            <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2 opacity-70" aria-hidden="true">
              <Search className="h-4 w-4" />
            </div>
            <CommandPrimitive.Input
              ref={inputRef}
              id={searchId}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                if (!open) setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  inputRef.current?.blur();
                  return;
                }
                if (event.key === 'Enter' && !items.length) {
                  event.preventDefault();
                  handleViewAll();
                }
              }}
              placeholder="Pesquise aqui"
              aria-label="Pesquisar"
              className="h-11 w-full rounded-full bg-white pl-9 pr-4 text-[14px] outline-none ring-1 ring-black/5 placeholder:text-gray-400 focus:ring-2 focus:ring-[#A94DFF]"
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[28px] border border-black/5 bg-white p-0 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.28)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === inputRef.current) return;
            setOpen(false);
          }}
        >
          <CommandPrimitive.List className="max-h-[420px] overflow-y-auto py-2">
            {loading && (
              <div className="px-4 py-4 text-sm text-gray-500">Carregando...</div>
            )}

            {!loading &&
              groups.map((group, groupIndex) => (
                <div key={group.key} className={cn(groupIndex > 0 && 'mt-1')}>
                  <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <CommandPrimitive.Item
                      key={`${group.key}-${item.id}`}
                      value={`${item.title} ${item.description ?? ''}`}
                      keywords={item.description ? [item.description] : undefined}
                      onSelect={() => handleSelect(item)}
                      className="mx-2 cursor-pointer rounded-2xl px-3 py-2.5 text-left outline-none"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-gray-900">{item.title}</span>
                        {item.description ? (
                          <span className="text-xs text-gray-500">{item.description}</span>
                        ) : null}
                      </div>
                    </CommandPrimitive.Item>
                  ))}
                </div>
              ))}

            {!loading && showPrompt && (
              <CommandPrimitive.Empty className="px-4 py-4 text-sm text-gray-500">
                {emptyMessage}
              </CommandPrimitive.Empty>
            )}

            {!loading && !error && query.trim().length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH && (
              <>
                <div className="mx-3 my-2 h-px bg-gray-100" />
                <CommandPrimitive.Item
                  value={`ver-todos ${query}`}
                  onSelect={handleViewAll}
                  className="mx-2 cursor-pointer rounded-2xl px-3 py-2.5 text-left outline-none"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-gray-900">Ver todos os resultados</span>
                    <span className="text-xs text-gray-500">Abrir a busca completa</span>
                  </div>
                </CommandPrimitive.Item>
              </>
            )}

            {!loading && error && (
              <div className="px-4 py-4 text-sm text-gray-500">{error}</div>
            )}
          </CommandPrimitive.List>
        </PopoverContent>
      </CommandPrimitive>
    </Popover>
  );
}