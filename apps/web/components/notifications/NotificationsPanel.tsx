'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, Close } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
  notificationCount?: number;
  items?: Array<{
    id: string;
    title: string;
    description?: string;
    read?: boolean;
    createdAt?: string;
    severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  }>;
  loading?: boolean;
  onItemClick?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onViewAll?: () => void;
}

function getSeverityMeta(severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' = 'INFO') {
  if (severity === 'SUCCESS') {
    return {
      accentClassName: 'bg-[#2f9e44]',
      badgeVariant: 'success' as const,
      label: 'Confirmado',
    };
  }
  if (severity === 'WARNING') {
    return {
      accentClassName: 'bg-[#d6a11d]',
      badgeVariant: 'warning' as const,
      label: 'Atenção',
    };
  }
  if (severity === 'CRITICAL') {
    return {
      accentClassName: 'bg-[#ef6b73]',
      badgeVariant: 'destructive' as const,
      label: 'Crítico',
    };
  }
  return {
    accentClassName: 'bg-[#72dff2]',
    badgeVariant: 'info' as const,
    label: 'Atualização',
  };
}

function summarizeNotificationMessage(message?: string): string {
  if (!message) return 'Atualização disponível.';
  const stripped = message.replace(/\*\*/g, '');
  const normalized = stripped.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61).trimEnd()}...`;
}

export default function NotificationsPanel({
  open,
  onClose,
  anchorRef,
  notificationCount = 0,
  items = [],
  loading = false,
  onItemClick,
  onMarkAllAsRead,
  onViewAll,
}: NotificationsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 360,
  });
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number; size: number }>({
    top: 12,
    left: 12,
    size: 44,
  });
  const prefersReducedMotion = useReducedMotion();

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Calcula posição do painel com base no elemento âncora
  const updatePosition = useCallback(() => {
    const anchor = anchorRef?.current;
    const panelW = Math.min(360, Math.max(280, window.innerWidth - 16));
    if (!anchor) {
      const top = 56 + 8;
      const left = Math.max(8, window.innerWidth - panelW - 16);
      setPos({ top, left, width: panelW });
      setAnchorPos({ top: 12, left: Math.max(8, window.innerWidth - 60), size: 44 });
      return;
    }
    const r = anchor.getBoundingClientRect();
    const top = Math.max(8, r.bottom + 8);
    const left = Math.min(window.innerWidth - panelW - 8, Math.max(8, r.right - panelW));
    setPos({ top, left, width: panelW });
    setAnchorPos({ top: r.top, left: r.left, size: Math.max(r.width, r.height) });
  }, [anchorRef]);

  useEffect(() => {
    if (open) {
      updatePosition();
      document.addEventListener('keydown', handleKey, true);
      document.addEventListener('mousedown', handleClickOutside, true);
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        document.removeEventListener('keydown', handleKey, true);
        document.removeEventListener('mousedown', handleClickOutside, true);
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [open, updatePosition, handleKey, handleClickOutside]);

  if (!mounted) return null;
  const hasItems = items.length > 0;

  const backdropTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.2, ease: 'easeOut' as const };

  const floatingTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, stiffness: 360, damping: 30, mass: 0.9 };

  return createPortal(
    <AnimatePresence initial={false}>
      {open ? (
        <>
          <motion.div
            key="notifications-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-[60] bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
            onClick={onClose}
          />
          <motion.button
            key="notifications-bell"
            type="button"
            aria-label="Fechar notificações"
            onClick={onClose}
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.92, y: -4 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94, y: -4 }}
            transition={floatingTransition}
            style={{ position: 'fixed', top: anchorPos.top, left: anchorPos.left, width: anchorPos.size, height: anchorPos.size }}
            className="z-[72] inline-flex items-center justify-center rounded-full bg-white text-gray-900 shadow-lg ring-1 ring-black/10 hover:bg-white alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:ring-white/10 alusa-dark:hover:bg-[color:var(--color-bg-elevated)]"
          >
            <Bell className="h-5 w-5" />
            {notificationCount > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white"
                aria-hidden="true"
              >
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
          </motion.button>
          <motion.div
            key="notifications-panel"
            role="dialog"
            aria-label="Notificações"
            ref={panelRef}
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.985, y: -14 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.985, y: -10 }}
            transition={floatingTransition}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[70] max-w-[calc(100vw-1rem)] flex max-h-[72vh] flex-col overflow-hidden rounded-3xl border border-[#ece7f5] bg-white shadow-xl shadow-[#1f163014] ring-1 ring-black/5 origin-top-right alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:shadow-black/40 alusa-dark:ring-white/5"
          >
        <div className="flex items-center justify-between border-b border-[#f0ebf7] px-5 pt-4 pb-3 alusa-dark:border-[color:var(--color-border-subtle)]">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Notificações</h2>
            <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Atualizações internas da operação</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar painel"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:hover:bg-[color:var(--color-bg-card-soft)] alusa-dark:hover:text-[color:var(--color-text-primary)] alusa-dark:focus:ring-offset-[color:var(--color-bg-card)]"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto" aria-live="polite">
          {loading ? (
            <div className="space-y-0 px-4 py-1.5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="border-b border-[#f0ebf7] py-3 last:border-b-0 alusa-dark:border-[color:var(--color-border-subtle)]">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-gray-200 alusa-dark:bg-[color:var(--color-border-strong)]/40" />
                  <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-gray-200 alusa-dark:bg-[color:var(--color-border-strong)]/40" />
                  <div className="mt-1.5 h-3 w-20 animate-pulse rounded bg-gray-200 alusa-dark:bg-[color:var(--color-border-strong)]/40" />
                </div>
              ))}
            </div>
          ) : hasItems ? (
            <div className="divide-y divide-[#f0ebf7] px-4 py-1.5 alusa-dark:divide-[color:var(--color-border-subtle)]">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick?.(n.id)}
                  className={cn(
                    '-mx-4 flex w-[calc(100%+2rem)] items-start gap-2.5 px-4 py-3 text-left text-sm transition-colors',
                    n.read
                      ? 'hover:bg-[#fcfbfe] alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]/70'
                      : 'hover:bg-[#faf6ff] alusa-dark:bg-[color:var(--color-bg-card-soft)]/35 alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]',
                  )}
                >
                  <div className={cn('mt-0.5 h-[70px] w-[3px] flex-none rounded-full', getSeverityMeta(n.severity).accentClassName)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium leading-4.5 text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{n.title}</p>
                        <p className="mt-0.5 line-clamp-1 text-[12px] leading-4.5 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                          {summarizeNotificationMessage(n.description)}
                        </p>
                        {n.createdAt && (
                          <p className="mt-1 text-[10px] text-gray-400 alusa-dark:text-[color:var(--color-text-muted)]">
                            {new Date(n.createdAt).toLocaleDateString()} •{' '}
                            {new Date(n.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                      {!n.read && (
                        <span
                          className="mt-1.5 h-2 w-2 flex-none rounded-full bg-violet-600 alusa-dark:bg-[color:var(--color-brand-400)]"
                          aria-label="Não lida"
                        />
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f4f1fb] text-[#7b56b8] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-brand-300)]">
                <Bell className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Nenhuma notificação por enquanto.</p>
              <p className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Novas atualizações internas aparecerão aqui.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#f0ebf7] bg-[#faf8fd] px-4 py-3 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs font-medium text-gray-600 hover:bg-transparent hover:text-gray-900 alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
            onClick={onMarkAllAsRead}
            disabled={!onMarkAllAsRead || loading || !hasItems}
          >
            Marcar todas como lidas
          </Button>
          <Button
            type="button"
            className="h-8 bg-[#7b56b8] px-3 text-xs text-white hover:bg-[#6d4aa2] alusa-dark:bg-[color:var(--color-button-primary-bg)] alusa-dark:hover:bg-[color:var(--color-button-primary-hover)]"
            onClick={onViewAll}
            disabled={!onViewAll}
          >
            Ver todas
          </Button>
        </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
