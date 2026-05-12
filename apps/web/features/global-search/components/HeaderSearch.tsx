'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Command as CommandPrimitive } from 'cmdk';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';

import { Close, Search } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '../constants';
import type { GlobalSearchItemDTO, GlobalSearchItemType } from '../dtos';
import { useGlobalSearch } from '../hooks/use-global-search';

type HeaderSearchProps = {
  role?: string | null;
};

const RESULT_TYPE_LABELS: Record<GlobalSearchItemType, string> = {
  action: 'Ação',
  aluno: 'Aluno',
  cobranca: 'Cobrança',
  contrato: 'Contrato',
  matricula: 'Matrícula',
  navigation: 'Navegação',
  responsavel: 'Responsável',
};

const RESULT_TYPE_VARIANTS: Record<GlobalSearchItemType, 'neutral' | 'info' | 'warning' | 'default'> = {
  action: 'default',
  aluno: 'neutral',
  cobranca: 'warning',
  contrato: 'info',
  matricula: 'default',
  navigation: 'neutral',
  responsavel: 'info',
};

export function HeaderSearch({ role = null }: HeaderSearchProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();
  const searchId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const floatingInputRef = useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [floatingFrame, setFloatingFrame] = useState({ top: 0, left: 0, width: 460 });
  const { query, setQuery, open, setOpen, loading, error, groups, items, selectItem, clearRecentItems } = useGlobalSearch({
    role,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [pathname, setOpen, setQuery]);

  const syncFloatingFrame = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setFloatingFrame({
      top: rect.top,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const shouldShowPopover = open && (loading || groups.length > 0 || Boolean(error));
  const showPrompt = !loading && !error && items.length === 0 && query.trim().length > 0;

  const emptyMessage = useMemo(() => {
    if (!query.trim()) return 'Nenhum atalho disponível';
    if (query.trim().length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) return 'Digite pelo menos 2 caracteres';
    return 'Nenhum resultado encontrado';
  }, [query]);

  const backdropTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.2, ease: 'easeOut' as const };

  const floatingTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, stiffness: 360, damping: 30, mass: 0.9 };

  const getResultTypeLabel = (type: GlobalSearchItemType) => RESULT_TYPE_LABELS[type] ?? 'Resultado';

  const getBadgeLabel = (item: GlobalSearchItemDTO) => item.badgeLabel ?? getResultTypeLabel(item.type);

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

  const handleInputValueChange = (value: string) => {
    setQuery(value);
    if (!open) setOpen(true);
  };

  const handleClearQuery = () => {
    setQuery('');
    floatingInputRef.current?.focus({ preventScroll: true });
  };

  const handleClearRecents = () => {
    clearRecentItems();
    floatingInputRef.current?.focus({ preventScroll: true });
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      floatingInputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && !items.length) {
      event.preventDefault();
      handleViewAll();
    }
  };

  useEffect(() => {
    if (!shouldShowPopover) return undefined;

    syncFloatingFrame();
    window.addEventListener('resize', syncFloatingFrame);
    window.addEventListener('scroll', syncFloatingFrame, true);

    return () => {
      window.removeEventListener('resize', syncFloatingFrame);
      window.removeEventListener('scroll', syncFloatingFrame, true);
    };
  }, [shouldShowPopover, syncFloatingFrame]);

  useEffect(() => {
    if (!shouldShowPopover) return;
    floatingInputRef.current?.focus({ preventScroll: true });
    const length = floatingInputRef.current?.value.length ?? 0;
    floatingInputRef.current?.setSelectionRange(length, length);
  }, [shouldShowPopover]);

  return (
    <>
      {mounted && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence initial={false}>
              {shouldShowPopover ? (
                <>
                  <motion.div
                    key="header-search-backdrop"
                    aria-hidden="true"
                    className="fixed inset-0 z-[60] bg-black/55"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={backdropTransition}
                    onClick={() => setOpen(false)}
                  />

                  <motion.div
                    key="header-search-input"
                    style={{
                      position: 'fixed',
                      top: floatingFrame.top,
                      left: floatingFrame.left,
                      width: floatingFrame.width,
                    }}
                    className="z-[72]"
                    initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.92, y: -4 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                    exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94, y: -4 }}
                    transition={floatingTransition}
                  >
                    <label htmlFor={`${searchId}-floating`} className="sr-only">
                      Pesquisar
                    </label>
                    <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2 opacity-70" aria-hidden="true">
                      <Search className="h-4 w-4" />
                    </div>
                    <input
                      ref={floatingInputRef}
                      id={`${searchId}-floating`}
                      type="text"
                      value={query}
                      onChange={(event) => handleInputValueChange(event.target.value)}
                      onKeyDown={handleInputKeyDown}
                      onFocus={() => setOpen(true)}
                      placeholder="Pesquise aqui"
                      aria-label="Pesquisar"
                      className="h-11 w-full rounded-full border border-[#e6e4ea] bg-white pl-9 pr-10 text-[14px] outline-none placeholder:text-gray-400 focus:outline-none"
                    />
                    {query.trim() ? (
                      <button
                        type="button"
                        aria-label="Limpar pesquisa"
                        onClick={handleClearQuery}
                        className="absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[#4c6fb3] transition-colors hover:bg-[#f3f6fb] hover:text-[#34548f] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40"
                      >
                        <Close className="h-4 w-4" />
                      </button>
                    ) : null}
                  </motion.div>
                </>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      <Popover open={shouldShowPopover} onOpenChange={setOpen}>
      <CommandPrimitive
        loop
        shouldFilter={false}
        className="w-full outline-none focus:outline-none focus-visible:outline-none"
      >
        <PopoverAnchor asChild>
          <div ref={containerRef} className="relative w-full max-w-[460px]">
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
              onValueChange={handleInputValueChange}
              onFocus={() => setOpen(true)}
              onKeyDown={handleInputKeyDown}
              placeholder="Pesquise aqui"
              aria-label="Pesquisar"
              tabIndex={shouldShowPopover ? -1 : 0}
              className={cn(
                'h-11 w-full rounded-full border border-[#e6e4ea] bg-white pl-9 pr-4 text-[14px] outline-none placeholder:text-gray-400 focus:outline-none',
                shouldShowPopover && 'pointer-events-none opacity-0',
              )}
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={8}
          className="z-[70] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[26px] border border-[#ece7f5] bg-white p-0 shadow-xl shadow-[#1f163014] ring-1 ring-black/5 outline-none duration-200 will-change-[transform,opacity] focus:outline-none focus-visible:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.985] data-[state=closed]:zoom-out-[0.985] data-[side=bottom]:slide-in-from-top-3 data-[side=top]:slide-in-from-bottom-3 data-[state=closed]:slide-out-to-top-1"
          style={{ borderRadius: 26, transformOrigin: 'var(--radix-popover-content-transform-origin)' }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === inputRef.current) return;
            setOpen(false);
          }}
        >
          <CommandPrimitive.List className="search-suggest-scroll-area max-h-[420px] overflow-y-auto py-2.5 outline-none focus:outline-none focus-visible:outline-none">
            {loading && (
              <div className="px-4 py-4 text-sm text-gray-500">Carregando...</div>
            )}

            {!loading &&
              groups.map((group, groupIndex) => (
                <div key={group.key} className={cn(groupIndex > 0 && 'mt-1.5')}>
                  <div className="flex items-center justify-between gap-3 px-5 pb-1.5 pt-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                      {group.label}
                    </div>
                    {group.key === 'recent' ? (
                      <button
                        type="button"
                        onClick={handleClearRecents}
                        className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b7280] transition-colors hover:text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30"
                      >
                        Limpar
                      </button>
                    ) : null}
                  </div>
                  {group.items.map((item) => (
                    <CommandPrimitive.Item
                      key={`${group.key}-${item.id}`}
                      value={`${item.title} ${item.description ?? ''}`}
                      keywords={item.description ? [item.description] : undefined}
                      onSelect={() => handleSelect(item)}
                      className="mx-2.5 cursor-pointer rounded-2xl px-4 py-3 text-left outline-none transition-colors hover:bg-[#f5f1fb] focus:outline-none focus-visible:outline-none data-[selected=true]:bg-[#f5f1fb] aria-selected:bg-[#f5f1fb]"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3.5">
                          <span className="min-w-0 text-sm font-medium text-gray-900">{item.title}</span>
                          <Badge
                            variant={RESULT_TYPE_VARIANTS[item.type]}
                            size="sm"
                            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]"
                          >
                            {getBadgeLabel(item)}
                          </Badge>
                        </div>
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
                  className="mx-2 cursor-pointer rounded-2xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-[#f5f1fb] focus:outline-none focus-visible:outline-none data-[selected=true]:bg-[#f5f1fb] aria-selected:bg-[#f5f1fb]"
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
    </>
  );
}