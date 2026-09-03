'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Icon } from '@/components/icons/Icon';
import { compactId, formatDateTime, formatSupportStatus } from '@/features/support/shared/format';
import { StatusBadge, SupportField } from '@/features/support/shared/SupportUI';
import type {
  SupportWebhookFilters,
  SupportWebhookListItem,
  SupportWebhookPage,
} from '@/features/support/queries/support-account';

type WebhookLogDetail = {
  id: string;
  evento: string | null;
  eventId: string | null;
  status?: string;
  recebidoEm: string;
  processadoEm?: string | null;
  ultimoErro?: string | null;
  tentativas?: number;
  asaasPaymentId?: string | null;
  asaasSubscriptionId?: string | null;
  asaasTransferId?: string | null;
  reason?: string;
  payload: unknown;
  attemptsLog?: unknown;
};

const EMPTY_FILTERS: Required<SupportWebhookFilters> = { event: '', status: '', period: '' };

const webhookEventLabels: Record<string, string> = {
  PAYMENT_ANTICIPATED: 'Pagamento antecipado',
  PAYMENT_CHECKOUT_VIEWED: 'Checkout visualizado',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  PAYMENT_CREATED: 'Pagamento criado',
  PAYMENT_DELETED: 'Pagamento excluído',
  PAYMENT_RECEIVED: 'Pagamento recebido',
  RECEIVABLE_ANTICIPATION_CREDITED: 'Antecipação de recebível creditada',
  RECEIVABLE_ANTICIPATION_PENDING: 'Antecipação de recebível pendente',
  SUBSCRIPTION_CREATED: 'Assinatura criada',
};

function formatWebhookEvent(event: string | null) {
  if (!event) return 'Evento não identificado';
  return webhookEventLabels[event] ?? event.replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
}

function buildWebhookUrl(page: number, filters: SupportWebhookFilters) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (filters.event) params.set('event', filters.event);
  if (filters.status) params.set('status', filters.status);
  if (filters.period) params.set('period', filters.period);
  const query = params.toString();
  return query ? `/webhooks?${query}` : '/webhooks';
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="support-webhooks-json">{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

export function WebhooksLogSplitView({
  webhooks,
  pagination,
  filters,
  eventTypes,
  statuses,
}: {
  webhooks: SupportWebhookListItem[];
  pagination: SupportWebhookPage;
  filters: Required<SupportWebhookFilters>;
  eventTypes: string[];
  statuses: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(webhooks[0]?.id ?? null);
  const [detail, setDetail] = useState<WebhookLogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Required<SupportWebhookFilters>>(filters);

  const selectedSummary = useMemo(
    () => webhooks.find((webhook) => webhook.id === selectedId) ?? null,
    [selectedId, webhooks],
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => setDraftFilters(filters), [filters]);

  useEffect(() => {
    if (!webhooks.some((webhook) => webhook.id === selectedId)) {
      setSelectedId(webhooks[0]?.id ?? null);
    }
  }, [selectedId, webhooks]);

  useEffect(() => {
    if (!selectedSummary) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const detailUrl = selectedSummary.source === 'rejected'
      ? `/api/admin/webhook-rejections/${encodeURIComponent(selectedSummary.id)}`
      : `/api/admin/contas/${encodeURIComponent(selectedSummary.contaId ?? '')}/webhooks/${encodeURIComponent(selectedSummary.id)}`;

    void fetch(detailUrl, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: WebhookLogDetail;
          error?: string;
        } | null;
        if (!response.ok || !json?.success || !json.data) {
          throw new Error(json?.error ?? 'Não foi possível carregar os detalhes do webhook.');
        }
        setDetail(json.data);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setDetail(null);
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os detalhes do webhook.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedSummary]);

  useEffect(() => {
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => window.clearInterval(refreshInterval);
  }, [router]);

  function navigate(page: number, nextFilters = filters) {
    startTransition(() => router.push(buildWebhookUrl(page, nextFilters)));
    setSelectedId(null);
    setDetail(null);
  }

  function applyFilters() {
    setFiltersOpen(false);
    navigate(1, draftFilters);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    navigate(1, EMPTY_FILTERS);
  }

  const firstItem = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastItem = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className="support-webhooks-split">
      <aside className="support-webhooks-log-list" aria-label="Lista de eventos">
        <div className="support-webhooks-log-list-header">
          <div className="support-webhooks-log-list-heading">
            <strong>Eventos recebidos</strong>
            <small>{pagination.total} eventos encontrados</small>
          </div>
          <div className="support-webhooks-log-list-tools">
            <div className="support-webhooks-filter">
              <button type="button" className="support-webhooks-filter-trigger" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
                <Icon name="Bars3" size={14} aria-hidden="true" />
                Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                <Icon name="ChevronDown" size={14} aria-hidden="true" />
              </button>
              {filtersOpen ? (
                <div className="support-webhooks-filter-popover">
                  <label>
                    Tipo de webhook
                    <span className="support-webhooks-filter-select">
                      <select value={draftFilters.event} onChange={(event) => setDraftFilters((current) => ({ ...current, event: event.target.value }))}>
                        <option value="">Todos</option>
                        {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{formatWebhookEvent(eventType)}</option>)}
                      </select>
                      <Icon name="ChevronDown" size={15} aria-hidden="true" />
                    </span>
                  </label>
                  <label>
                    Status da resposta
                    <span className="support-webhooks-filter-select">
                      <select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}>
                        <option value="">Todos</option>
                        {statuses.map((status) => <option key={status} value={status}>{formatSupportStatus(status)}</option>)}
                      </select>
                      <Icon name="ChevronDown" size={15} aria-hidden="true" />
                    </span>
                  </label>
                  <label>
                    Período
                    <span className="support-webhooks-filter-select">
                      <select value={draftFilters.period} onChange={(event) => setDraftFilters((current) => ({ ...current, period: event.target.value }))}>
                        <option value="">Todo o período</option>
                        <option value="1">Hoje</option>
                        <option value="7">Últimos 7 dias</option>
                        <option value="14">Últimos 14 dias</option>
                      </select>
                      <Icon name="ChevronDown" size={15} aria-hidden="true" />
                    </span>
                  </label>
                  <div className="support-webhooks-filter-actions">
                    <button type="button" onClick={clearFilters}>Limpar</button>
                    <button type="button" className="is-primary" onClick={applyFilters} disabled={isPending}>Aplicar</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="support-webhooks-log-list-scroll" aria-busy={isPending}>
          {webhooks.length > 0 ? webhooks.map((webhook) => (
            <button key={`${webhook.source}-${webhook.id}`} type="button" className={`support-webhooks-log-item${selectedId === webhook.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(webhook.id)} aria-pressed={selectedId === webhook.id}>
              <span className="support-webhooks-log-item-copy">
                <strong>{formatWebhookEvent(webhook.evento)}</strong>
                <small>{webhook.conta.nome} · {formatDateTime(webhook.recebidoEm)}</small>
              </span>
              <StatusBadge value={webhook.status} />
            </button>
          )) : <p className="support-webhooks-log-empty">Nenhum evento encontrado.</p>}
        </div>

        {pagination.totalPages > 1 ? (
          <div className="support-webhooks-log-pagination" aria-label="Paginação dos eventos">
            <span>{firstItem}–{lastItem} de {pagination.total}</span>
            <div>
              <button type="button" onClick={() => navigate(pagination.page - 1)} disabled={pagination.page === 1 || isPending} aria-label="Eventos anteriores">
                <Icon name="ChevronRight" size={15} className="support-webhooks-log-pagination-previous" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => navigate(pagination.page + 1)} disabled={pagination.page === pagination.totalPages || isPending} aria-label="Próximos eventos">
                <Icon name="ChevronRight" size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <div className="support-webhooks-log-detail">
        {loading ? <p className="support-webhooks-log-state">Carregando detalhes…</p> : null}
        {error ? <p className="support-webhooks-log-error">{error}</p> : null}
        {!loading && !error && detail && selectedSummary ? (
          <>
            <div className="support-webhooks-log-detail-heading">
              <div>
                <p className="support-webhooks-log-kicker">{selectedSummary.source === 'rejected' ? 'Evento rejeitado' : 'Evento selecionado'}</p>
                <h3>{formatWebhookEvent(detail.evento ?? selectedSummary.evento)}</h3>
                <p className="support-webhooks-log-account">{selectedSummary.conta.nome}</p>
              </div>
              <StatusBadge value={selectedSummary.status} />
            </div>

            <div className="support-fields support-webhooks-log-fields">
              <SupportField label="ID do evento" value={detail.eventId ?? detail.id} />
              <SupportField label="Recebido em" value={formatDateTime(detail.recebidoEm)} />
              <SupportField label="Processado em" value={formatDateTime(detail.processadoEm)} />
              <SupportField label="Tentativas" value={detail.tentativas} />
              <SupportField label="Correlação" value={compactId(detail.asaasPaymentId ?? detail.asaasSubscriptionId ?? detail.asaasTransferId)} />
              <SupportField label={selectedSummary.source === 'rejected' ? 'Motivo da rejeição' : 'Erro'} value={detail.reason ?? detail.ultimoErro ?? 'Sem erro'} />
            </div>

            <section className="support-webhooks-json-section">
              <h4>Conteúdo recebido</h4>
              <JsonBlock value={detail.payload} />
            </section>

            {selectedSummary.source === 'received' ? (
              <section className="support-webhooks-json-section">
                <h4>Histórico de tentativas</h4>
                <JsonBlock value={detail.attemptsLog ?? []} />
              </section>
            ) : null}
          </>
        ) : null}
        {!loading && !error && !detail ? <p className="support-webhooks-log-state">{pagination.total > 0 ? 'Selecione um evento para ver os detalhes.' : 'Nenhum detalhe para exibir.'}</p> : null}
      </div>
    </div>
  );
}
