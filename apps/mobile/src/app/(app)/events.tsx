import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { EventFilterSheet, type EventStatusFilter } from '@/features/events/components/EventFilterSheet';
import { EventListSkeleton } from '@/features/events/components/EventSkeleton';
import { eventsService } from '@/features/events/services/events-service';
import { eventStatusLabel, eventTypeLabel, formatEventDate } from '@/features/events/utils/format';
import type { MobileEvent } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EventsScreen() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('ALL');
  const [filterVisible, setFilterVisible] = useState(false);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await eventsService.listEvents({ pageSize: 100 });
      setEvents(result.events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os eventos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const visibleEvents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return events
      .filter((event) => statusFilter === 'ALL' || event.status === statusFilter)
      .filter((event) => {
        if (!normalizedSearch) return true;
        return [event.name, event.locationName, event.description]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalizedSearch));
      })
      .sort((first, second) => new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime());
  }, [events, search, statusFilter]);

  const emptyTitle = search.trim() || statusFilter !== 'ALL' ? 'Nenhum evento encontrado' : 'Nenhum evento cadastrado';
  const emptyMessage = search.trim() || statusFilter !== 'ALL'
    ? 'Revise a busca ou ajuste o filtro para tentar novamente.'
    : 'Os eventos da conta aparecerão aqui quando forem cadastrados.';

  return (
    <Screen
      scroll
      keyboard
      backgroundColor={colors.surface}
      refreshing={refreshing}
      onRefresh={() => void loadEvents('refresh')}
      style={styles.screen}
    >
      <InlineSearchHeader
        title="Eventos"
        search={search}
        onSearchChange={setSearch}
        placeholder="Procurar evento"
        accessibilityLabel="Pesquisar eventos"
        onBack={() => router.back()}
        onFilterPress={() => setFilterVisible(true)}
        filterActive={statusFilter !== 'ALL'}
      />

      <View style={styles.introduction}>
        <AppText variant="small" tone="muted">Acompanhe os eventos e consulte as informações mais importantes.</AppText>
      </View>

      {loading ? <EventListSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadEvents()} /> : null}
      {!loading && !error && visibleEvents.length === 0 ? <EmptyState variant="neutral" title={emptyTitle} message={emptyMessage} /> : null}
      {!loading && !error && visibleEvents.length > 0 ? (
        <View style={styles.list}>
          {visibleEvents.map((event) => <EventCard key={event.id} event={event} />)}
        </View>
      ) : null}

      <EventFilterSheet visible={filterVisible} value={statusFilter} onChange={setStatusFilter} onClose={() => setFilterVisible(false)} />
    </Screen>
  );
}

function EventCard({ event }: { event: MobileEvent }) {
  const statusTone = getStatusTone(event.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir detalhes de ${event.name}`}
      onPress={() => router.push({ pathname: '/(app)/events/[eventId]', params: { eventId: event.id } })}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.cardCopy}>
        <AppText variant="subheading" weight="medium" numberOfLines={1}>{event.name}</AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>{formatEventDate(event.startsAt)} · {eventTypeLabel(event.type)}</AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>{event.locationName || 'Local não informado'}</AppText>
      </View>
      <View style={styles.cardMeta}>
        <View style={[styles.statusBadge, { backgroundColor: statusTone.background }]}>
          <View style={[styles.statusDot, { backgroundColor: statusTone.foreground }]} />
          <AppText variant="tiny" weight="medium" style={{ color: statusTone.foreground }}>{eventStatusLabel(event.status)}</AppText>
        </View>
        <AppText variant="small" tone="muted" numberOfLines={1}>{event.metrics.ingressosVendidos} {event.metrics.ingressosVendidos === 1 ? 'ingresso' : 'ingressos'}</AppText>
      </View>
      <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} />
    </Pressable>
  );
}

function getStatusTone(status: string) {
  if (status === 'ACTIVE') return { foreground: colors.success, background: colors.accentSoft };
  if (status === 'CANCELLED') return { foreground: colors.danger, background: colors.dangerSoft };
  if (status === 'FINISHED') return { foreground: colors.brand, background: colors.brandSoft };
  return { foreground: colors.warning, background: colors.brandSoft };
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 116 },
  introduction: { paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  card: { minHeight: 106, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  cardCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  cardMeta: { alignItems: 'flex-end', gap: spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  pressed: { opacity: 0.76 },
});
