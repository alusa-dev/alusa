'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCircle, ExternalLink, EyeOff, Mail, Trash } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomScrollArea } from '@/components/ui/custom-scroll-area';
import { cn } from '@/lib/cn';
import { useNotificationsFeed } from './hooks/use-notifications-feed';
import type { NotificationItem, NotificationSeverity, NotificationView } from './types';

type CobrancaActionResponse = {
  data?: {
    status?: string | null;
    asaasData?: {
      transactionReceiptUrl?: string | null;
      invoiceUrl?: string | null;
    };
  };
};

const PAID_CHARGE_STATUSES = new Set([
  'PAGO',
  'PAID',
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return formatter.format(days, 'day');
}

function renderMessagePreview(text: string): React.ReactNode {
  const inline = text.replace(/\n+/g, ' ');
  return inline.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function renderMessageFull(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block empty:hidden">
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={j} className="font-semibold text-gray-800">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </span>
  ));
}

function getSeverityMeta(severity: NotificationSeverity) {
  if (severity === 'SUCCESS') {
    return {
      label: 'Confirmado',
      badgeVariant: 'success' as const,
      accentClassName: 'bg-[#2f9e44]',
    };
  }
  if (severity === 'WARNING') {
    return {
      label: 'Atenção',
      badgeVariant: 'warning' as const,
      accentClassName: 'bg-[#d6a11d]',
    };
  }
  if (severity === 'CRITICAL') {
    return {
      label: 'Crítico',
      badgeVariant: 'destructive' as const,
      accentClassName: 'bg-[#ef6b73]',
    };
  }
  return {
    label: 'Atualização',
    badgeVariant: 'info' as const,
    accentClassName: 'bg-[#72dff2]',
  };
}

function NotificationListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-gray-100 bg-white p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function NotificationEmptyState({ archived }: { archived: boolean }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f4f1fb] text-[#7b56b8]">
        <Bell className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-900">
          {archived ? 'Nenhuma notificação arquivada' : 'Nenhuma notificação disponível'}
        </h3>
        <p className="max-w-sm text-sm text-gray-500">
          {archived
            ? 'Quando você arquivar uma atualização, ela aparecerá aqui para consulta futura.'
            : 'Novas atualizações sobre matrícula, cobrança e pagamento aparecerão aqui.'}
        </p>
      </div>
    </div>
  );
}

export function NotificationsInboxPage() {
  const router = useRouter();
  const [view, setView] = useState<NotificationView>('active');
  const {
    items,
    unreadCount,
    totalCount,
    loading,
    submitting,
    updateNotification,
    deleteNotification,
    markAllAsRead,
  } =
    useNotificationsFeed({ view, limit: 50, autoRefreshMs: 60000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingContext, setOpeningContext] = useState(false);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function handleSelect(item: NotificationItem) {
    setSelectedId(item.id);
    if (!item.readAt && !item.archivedAt) {
      await updateNotification(item.id, 'read');
    }
  }

  async function handleDeleteSelected() {
    if (!selectedItem) return;
    await deleteNotification(selectedItem.id);
  }

  async function handleOpenSelectedContext() {
    if (!selectedItem) return;

    const isBillingNotification = selectedItem.entityType === 'Cobranca' && selectedItem.entityId;
    if (!isBillingNotification) {
      if (selectedItem.relatedPath) {
        router.push(selectedItem.relatedPath);
      }
      return;
    }

    setOpeningContext(true);
    try {
      const response = await fetch(`/api/cobrancas/${selectedItem.entityId}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json().catch(() => null)) as CobrancaActionResponse | null;
      if (!response.ok) {
        throw new Error('Não foi possível abrir o contexto desta cobrança.');
      }

      const status = String(payload?.data?.status ?? '').toUpperCase();
      const receiptUrl = payload?.data?.asaasData?.transactionReceiptUrl ?? null;
      const invoiceUrl = payload?.data?.asaasData?.invoiceUrl ?? null;

      if (PAID_CHARGE_STATUSES.has(status)) {
        const externalUrl = receiptUrl || invoiceUrl;
        if (externalUrl) {
          window.open(externalUrl, '_blank', 'noopener,noreferrer');
          return;
        }
      }

      router.push(`/cobrancas/${selectedItem.entityId}`);
    } catch (error) {
      console.error('[Notifications][openContext]', error);
      if (selectedItem.relatedPath) {
        router.push(selectedItem.relatedPath);
      }
    } finally {
      setOpeningContext(false);
    }
  }

  const primaryActionLabel = useMemo(() => {
    if (!selectedItem) return 'Abrir contexto';
    if (selectedItem.entityType === 'Cobranca' && selectedItem.entityId) {
      return selectedItem.type === 'PAYMENT_CONFIRMED'
        ? 'Abrir comprovante'
        : selectedItem.type === 'PAYMENT_REFUNDED' || selectedItem.type === 'BILLING_CANCELLED'
          ? 'Ver cobrança'
          : 'Abrir cobrança';
    }
    return 'Abrir contexto';
  }, [selectedItem]);

  return (
    <section
      aria-label="Conteúdo da central de notificações"
      className="box-border flex h-full min-h-0 flex-col gap-6 overflow-hidden pr-6 pb-8"
    >
      <div className="flex flex-col gap-4 rounded-xl border border-[#ece7f5] bg-white p-6 shadow-sm shadow-[#1f163014] md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Central de Notificações</h1>
            <p className="mt-1 text-sm text-gray-600">
              Veja todas as notificações de matrículas, cobranças e pagamentos da equipe administrativa.
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-[#7b56b8]">
              {unreadCount} não lida{unreadCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-[#ece7f5] bg-white p-1">
            {[
              { value: 'active', label: 'Ativas' },
              { value: 'archived', label: 'Arquivadas' },
              { value: 'all', label: 'Todas' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value as NotificationView)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  view === option.value
                    ? 'bg-[#7b56b8] text-white shadow-sm'
                    : 'text-gray-600 hover:bg-[#f4f1fb] hover:text-gray-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="rounded-full border border-[#ece7f5] px-4 text-xs font-medium text-gray-600 hover:bg-[#f7f3fc] hover:text-gray-900"
            onClick={() => void markAllAsRead()}
            disabled={submitting || unreadCount === 0}
          >
            Marcar todas como lidas
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-stretch">
        <Card className="overflow-hidden border-[#ece7f5] bg-white shadow-sm shadow-[#1f163010] xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          <CardHeader className="border-b border-[#f0ebf7] pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-gray-950">Fila de notificações</CardTitle>
              <Badge variant="neutral">{totalCount}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 xl:min-h-0 xl:flex-1">
            <CustomScrollArea className="h-[520px] xl:h-full" disableInnerWrapper>
              {loading ? (
                <NotificationListSkeleton />
              ) : items.length === 0 ? (
                <NotificationEmptyState archived={view === 'archived'} />
              ) : (
                <div className="divide-y divide-[#f2edf8]">
                  {items.map((item) => {
                    const severity = getSeverityMeta(item.severity);
                    const isActive = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleSelect(item)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-4 text-left transition-colors',
                          isActive ? 'bg-[#faf6ff]' : 'bg-white hover:bg-[#fcfbfe]',
                        )}
                      >
                        <div className={cn('mt-0.5 h-[76px] w-[3px] flex-none rounded-full', severity.accentClassName)} />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                            {!item.readAt && !item.archivedAt ? (
                              <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-[#7b56b8]" />
                            ) : null}
                          </div>
                          <p className="line-clamp-2 text-[13px] leading-6 text-gray-600">{renderMessagePreview(item.message)}</p>
                          <div className="flex items-center gap-2 text-[11px] text-gray-400">
                            <span title={formatDateTime(item.triggeredAt)}>{formatRelativeTime(item.triggeredAt)}</span>
                            <span aria-hidden="true">•</span>
                            <span>{formatDateTime(item.triggeredAt)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CustomScrollArea>
          </CardContent>
        </Card>

        <Card className="border-[#ece7f5] bg-white shadow-sm shadow-[#1f163010] xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          {loading ? (
            <CardContent className="space-y-4 p-6 xl:min-h-0 xl:flex-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-40" />
            </CardContent>
          ) : selectedItem ? (
            <>
              <CardContent className="p-0 xl:min-h-0 xl:flex-1">
                <CustomScrollArea className="h-[520px] xl:h-full" disableInnerWrapper>
                  <div className="flex flex-col">
                    <div className="flex w-full items-center justify-center border-b border-[#f0ebf7] px-8 py-3">
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          aria-busy={submitting}
                          className="flex items-center gap-2 rounded-full text-gray-500 hover:bg-[#f7f3fc] hover:text-gray-900 px-3 py-2"
                          title={selectedItem.readAt ? 'Marcar como não lida' : 'Marcar como lida'}
                          aria-label={selectedItem.readAt ? 'Marcar como não lida' : 'Marcar como lida'}
                          onClick={() => void updateNotification(selectedItem.id, selectedItem.readAt ? 'unread' : 'read')}
                          disabled={submitting}
                        >
                          {selectedItem.readAt ? <EyeOff className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                          <span className="text-xs font-medium">
                            {selectedItem.readAt ? 'Marcar como não lida' : 'Marcar como lida'}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-busy={submitting}
                          className="flex items-center gap-2 rounded-full text-gray-500 hover:bg-[#f7f3fc] hover:text-gray-900 px-3 py-2"
                          title={selectedItem.archivedAt ? 'Desarquivar' : 'Arquivar'}
                          aria-label={selectedItem.archivedAt ? 'Desarquivar' : 'Arquivar'}
                          onClick={() => void updateNotification(selectedItem.id, selectedItem.archivedAt ? 'unarchive' : 'archive')}
                          disabled={submitting}
                        >
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-xs font-medium">
                            {selectedItem.archivedAt ? 'Desarquivar' : 'Arquivar'}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-busy={submitting}
                          className="flex items-center gap-2 rounded-full text-[#c9485b] hover:bg-[#fff5f6] hover:text-[#b33f51] px-3 py-2"
                          title="Excluir notificação"
                          aria-label="Excluir notificação"
                          onClick={() => void handleDeleteSelected()}
                          disabled={submitting}
                        >
                          <Trash className="h-4 w-4" />
                          <span className="text-xs font-medium">Excluir notificação</span>
                        </Button>
                      </div>
                    </div>
                    <div className="mx-auto flex max-w-3xl flex-col items-start justify-center gap-8 p-8 min-h-[340px] xl:min-h-[420px]">
                      <div className="space-y-4 w-full flex flex-col items-start">
                        <div className="space-y-3 border-b border-[#f0ebf7] pb-6 w-full flex flex-col items-start">
                          <CardTitle className="text-[28px] font-semibold leading-tight text-gray-950 text-left">
                            {selectedItem.title}
                          </CardTitle>
                          <p className="text-sm text-gray-500 text-left">{formatDateTime(selectedItem.triggeredAt)}</p>
                        </div>
                        <p className="max-w-2xl text-left text-[15px] leading-8 text-gray-700">
                          {renderMessageFull(selectedItem.message)}
                        </p>
                      </div>
                      {(selectedItem.relatedPath || (selectedItem.entityType === 'Cobranca' && selectedItem.entityId)) ? (
                        <div className="flex justify-start w-full">
                          <Button
                            type="button"
                            className="h-11 rounded-full bg-[#7b56b8] px-5 text-white hover:bg-[#6d4aa2]"
                            onClick={() => void handleOpenSelectedContext()}
                            disabled={openingContext}
                          >
                            {primaryActionLabel}
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CustomScrollArea>
              </CardContent>
            </>
          ) : (
            <NotificationEmptyState archived={view === 'archived'} />
          )}
        </Card>
      </div>
    </section>
  );
}
