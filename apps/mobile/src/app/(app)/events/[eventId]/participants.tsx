import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { useAppRefresh } from '@/hooks/use-app-refresh';
import {
  EventParticipantFilterSheet,
  type EventParticipantStatusFilter,
} from '@/features/events/components/EventParticipantFilterSheet';
import {
  EventParticipantList,
  EventParticipantListFooter,
  EventParticipantListSkeleton,
} from '@/features/events/components/EventParticipantList';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEvent, MobileEventParticipant } from '@/features/events/types/events';
import { colors, spacing } from '@/theme/tokens';

const PAGE_SIZE = 10;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function EventParticipantsScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const eventId = firstParam(params.eventId) ?? '';
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(Boolean(eventId));
  const [eventError, setEventError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [status, setStatus] = useState<EventParticipantStatusFilter>('ALL');
  const [filterVisible, setFilterVisible] = useState(false);
  const [participants, setParticipants] = useState<MobileEventParticipant[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; pageSize: number; pageCount: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(eventId ? null : 'Não foi possível identificar o evento.');
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

  const loadParticipants = useCallback(async (options: { silent?: boolean } = {}) => {
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
      setParticipants([]);
      setMeta(null);
    }
    setError(null);
    setLoadMoreError(null);
    try {
      const response = await eventsService.listEventParticipants(eventId, {
        page: 1,
        pageSize: PAGE_SIZE,
        search: activeSearch || undefined,
        status: status === 'ALL' ? undefined : status,
      });
      if (requestId !== requestIdRef.current) return;
      setParticipants(response.participants);
      setMeta(response.meta);
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os alunos inscritos.');
      if (!silent) {
        setParticipants([]);
        setMeta(null);
      }
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false);
    }
  }, [activeSearch, eventId, status]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

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
      const response = await eventsService.listEventParticipants(eventId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        search: activeSearch || undefined,
        status: status === 'ALL' ? undefined : status,
      });
      if (requestId !== requestIdRef.current) return;
      setParticipants((current) => {
        const currentIds = new Set(current.map((participant) => participant.id));
        return [...current, ...response.participants.filter((participant) => !currentIds.has(participant.id))];
      });
      setMeta(response.meta);
    } catch (reason) {
      if (requestId === requestIdRef.current) setLoadMoreError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais alunos.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [activeSearch, eventId, loading, loadingMore, meta, status]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadEvent({ silent: true }), loadParticipants({ silent: true })]);
  }, [loadEvent, loadParticipants]);

  const { refreshing, refresh } = useAppRefresh(refreshAll, { intervalMs: null });
  const pageError = eventError ?? error;
  const isInitialLoading = loading || eventLoading;

  const openStudent = useCallback((participant: MobileEventParticipant) => {
    if (!participant.alunoId) return;
    router.push({ pathname: '/(app)/students/[studentId]', params: { studentId: participant.alunoId } });
  }, []);

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={styles.headerContent}>
        <InlineSearchHeader
          title="Alunos inscritos"
          search={search}
          onSearchChange={setSearch}
          placeholder="Pesquisar aluno"
          accessibilityLabel="Pesquisar alunos inscritos"
          onBack={() => router.back()}
          onFilterPress={() => setFilterVisible(true)}
          filterActive={status !== 'ALL'}
        />
        {event ? <AppText variant="small" tone="muted" numberOfLines={1}>{event.name}</AppText> : null}
        {!isInitialLoading && !pageError && meta ? <AppText variant="small" tone="subtle">{meta.total} {meta.total === 1 ? 'aluno inscrito' : 'alunos inscritos'}</AppText> : null}
      </View>

      {isInitialLoading ? <EventParticipantListSkeleton count={5} /> : null}
      {!isInitialLoading && pageError ? <ErrorState title="Não foi possível carregar" message={pageError} actionLabel="Tentar novamente" onAction={() => { void loadEvent(); void loadParticipants(); }} /> : null}
      {!isInitialLoading && !pageError && participants.length === 0 ? <EmptyState title="Nenhum aluno inscrito" message={activeSearch || status !== 'ALL' ? 'Tente ajustar a busca ou o filtro.' : 'Os alunos inscritos neste evento aparecerão aqui.'} /> : null}
      {!isInitialLoading && !pageError && participants.length > 0 ? <EventParticipantList participants={participants} onParticipantPress={openStudent} /> : null}
      {!isInitialLoading && !pageError && participants.length > 0 && meta ? <EventParticipantListFooter hasMore={meta.page < meta.pageCount} loading={loadingMore} error={loadMoreError} onRetry={() => void loadMore()} onLoadMore={() => void loadMore()} /> : null}

      <EventParticipantFilterSheet
        visible={filterVisible}
        value={status}
        onChange={setStatus}
        onClose={() => setFilterVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md, paddingBottom: spacing['2xl'] },
  headerContent: { gap: spacing.sm },
});
