import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Screen } from '@/components/layout/Screen';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { AppText } from '@/components/primitives/AppText';
import { useAppRefresh } from '@/hooks/use-app-refresh';
import { EventFinancialEntrySheet } from '@/features/events/components/EventFinancialEntrySheet';
import {
  EventFinancialEntryList,
  EventFinancialEntryListSkeleton,
  EventFinancialListFooter,
} from '@/features/events/components/EventFinancialEntryList';
import {
  EventFinancialFilterSheet,
  type EventFinancialStatusFilter,
  type EventFinancialTypeFilter,
} from '@/features/events/components/EventFinancialFilterSheet';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEvent, MobileEventFinancialEntry } from '@/features/events/types/events';
import { colors, spacing } from '@/theme/tokens';

const PAGE_SIZE = 10;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function EventFinancialEntriesScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const eventId = firstParam(params.eventId) ?? '';
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(Boolean(eventId));
  const [eventError, setEventError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [type, setType] = useState<EventFinancialTypeFilter>('ALL');
  const [status, setStatus] = useState<EventFinancialStatusFilter>('ALL');
  const [draftType, setDraftType] = useState<EventFinancialTypeFilter>('ALL');
  const [draftStatus, setDraftStatus] = useState<EventFinancialStatusFilter>('ALL');
  const [filterVisible, setFilterVisible] = useState(false);
  const [entries, setEntries] = useState<MobileEventFinancialEntry[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; pageSize: number; pageCount: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(eventId ? null : 'Não foi possível identificar o evento.');
  const [selectedEntry, setSelectedEntry] = useState<MobileEventFinancialEntry | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadEvent = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!eventId) {
      setEventError('Não foi possível identificar o evento.');
      setEventLoading(false);
      return;
    }
    if (!options.silent) setEventLoading(true);
    setEventError(null);
    try {
      const response = await eventsService.getEvent(eventId);
      setEvent(response.event);
    } catch (reason) {
      setEventError(reason instanceof Error ? reason.message : 'Não foi possível carregar o evento.');
    } finally {
      if (!options.silent) setEventLoading(false);
    }
  }, [eventId]);

  const loadEntries = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!eventId) {
      setError('Não foi possível identificar o evento.');
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const silent = options.silent ?? false;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!silent) {
      setLoading(true);
      setEntries([]);
      setMeta(null);
    }
    setError(null);
    setLoadMoreError(null);
    try {
      const response = await eventsService.listFinancialEntries(eventId, {
        page: 1,
        pageSize: PAGE_SIZE,
        search: activeSearch || undefined,
        type: type === 'ALL' ? undefined : type,
        status: status === 'ALL' ? undefined : status,
      });
      if (requestId !== requestIdRef.current) return;
      setEntries(response.entries);
      setMeta(response.meta);
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os lançamentos.');
      if (!silent) {
        setEntries([]);
        setMeta(null);
      }
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false);
    }
  }, [activeSearch, eventId, status, type]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    const timeout = setTimeout(() => setActiveSearch(search.trim()), 260);
    return () => clearTimeout(timeout);
  }, [search]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || loadingMoreRef.current || !meta || meta.page >= meta.pageCount) return;
    const requestId = ++requestIdRef.current;
    const nextPage = meta.page + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await eventsService.listFinancialEntries(eventId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        search: activeSearch || undefined,
        type: type === 'ALL' ? undefined : type,
        status: status === 'ALL' ? undefined : status,
      });
      if (requestId !== requestIdRef.current) return;
      setEntries((current) => {
        const currentIds = new Set(current.map((entry) => entry.id));
        return [...current, ...response.entries.filter((entry) => !currentIds.has(entry.id))];
      });
      setMeta(response.meta);
    } catch (reason) {
      if (requestId === requestIdRef.current) setLoadMoreError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais lançamentos.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [activeSearch, eventId, loading, loadingMore, meta, status, type]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadEvent({ silent: true }), loadEntries({ silent: true })]);
  }, [loadEntries, loadEvent]);

  const { refreshing, refresh } = useAppRefresh(refreshAll, { intervalMs: null });

  const openFilters = useCallback(() => {
    setDraftType(type);
    setDraftStatus(status);
    setFilterVisible(true);
  }, [status, type]);

  const applyFilters = useCallback(() => {
    setType(draftType);
    setStatus(draftStatus);
    setFilterVisible(false);
  }, [draftStatus, draftType]);

  const clearFilters = useCallback(() => {
    setDraftType('ALL');
    setDraftStatus('ALL');
  }, []);

  const pageError = eventError ?? error;
  const isInitialLoading = loading || eventLoading;

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={styles.headerContent}>
        <InlineSearchHeader
          title="Lançamentos financeiros"
          search={search}
          onSearchChange={setSearch}
          placeholder="Pesquisar lançamento"
          accessibilityLabel="Pesquisar lançamentos"
          onBack={() => router.back()}
          onFilterPress={openFilters}
          filterActive={type !== 'ALL' || status !== 'ALL'}
        />
        {event ? <AppText variant="small" tone="muted" numberOfLines={1}>{event.name}</AppText> : null}
        {!isInitialLoading && !pageError && meta ? <AppText variant="small" tone="subtle">{meta.total} {meta.total === 1 ? 'registro' : 'registros'}</AppText> : null}
      </View>

      {isInitialLoading ? <EventFinancialEntryListSkeleton count={5} /> : null}
      {!isInitialLoading && pageError ? <ErrorState title="Não foi possível carregar" message={pageError} actionLabel="Tentar novamente" onAction={() => { void loadEvent(); void loadEntries(); }} /> : null}
      {!isInitialLoading && !pageError && entries.length === 0 ? <EmptyState title="Nenhum lançamento encontrado" message={activeSearch || type !== 'ALL' || status !== 'ALL' ? 'Tente ajustar a busca ou os filtros.' : 'Os lançamentos financeiros do evento aparecerão aqui quando forem registrados.'} /> : null}
      {!isInitialLoading && !pageError && entries.length > 0 ? <EventFinancialEntryList entries={entries} onEntryPress={(entry) => { setSelectedEntry(entry); setSheetVisible(true); }} /> : null}
      {!isInitialLoading && !pageError && entries.length > 0 && meta ? <EventFinancialListFooter hasMore={meta.page < meta.pageCount} loading={loadingMore} error={loadMoreError} onRetry={() => void loadMore()} onLoadMore={() => void loadMore()} /> : null}

      <EventFinancialFilterSheet
        visible={filterVisible}
        type={draftType}
        status={draftStatus}
        onTypeChange={setDraftType}
        onStatusChange={setDraftStatus}
        onClear={clearFilters}
        onApply={applyFilters}
        onClose={() => setFilterVisible(false)}
      />

      <EventFinancialEntrySheet
        eventId={eventId}
        entry={selectedEntry}
        visible={sheetVisible}
        canManage={event?.capabilities.canManageFinancial ?? false}
        onClose={() => { setSheetVisible(false); setSelectedEntry(null); }}
        onChanged={() => loadEntries({ silent: true })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md, paddingBottom: spacing['2xl'] },
  headerContent: { gap: spacing.sm },
});
