import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { FunnelIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { AgendaCalendar } from '@/features/agenda/components/AgendaCalendar';
import { AgendaEventSheet } from '@/features/agenda/components/AgendaEventSheet';
import { AgendaFilterSheet } from '@/features/agenda/components/AgendaFilterSheet';
import { AgendaSkeleton } from '@/features/agenda/components/AgendaSkeleton';
import { agendaService } from '@/features/agenda/services/agenda-service';
import type { AgendaFilters, AgendaResources, AgendaViewMode, CalendarEvent, CalendarEventDetails } from '@/features/agenda/types/agenda';
import { addDays, addMonths, dateFromKey, dateKey, getAgendaRange, isSameMonth } from '@/features/agenda/utils/date';
import { colors, radius, spacing } from '@/theme/tokens';

type AgendaLoader = (_mode?: 'initial' | 'refresh') => Promise<void>;

export default function AgendaScreen() {
  const [anchor, setAnchor] = useState(new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(dateKey(new Date()));
  const [viewMode, setViewMode] = useState<AgendaViewMode>('week');
  const [filters, setFilters] = useState<AgendaFilters>({});
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [timeZone, setTimeZone] = useState('America/Sao_Paulo');
  const [resources, setResources] = useState<AgendaResources | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const hasLoadedData = useRef(false);
  const hasFocusedAgenda = useRef(false);
  const loadEventsRef = useRef<AgendaLoader | null>(null);

  const loadEvents = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (mode === 'refresh') setRefreshing(true);
    else if (!hasLoadedData.current) setLoading(true);
    setError(null);

    const range = getAgendaRange(anchor, viewMode);
    try {
      const result = await agendaService.listEvents({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        viewMode,
        filters,
      });
      if (requestSequence.current !== sequence) return;
      setEvents(result.data.events);
      setTimeZone(result.data.timeZone);
      hasLoadedData.current = true;
    } catch (reason) {
      if (requestSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a agenda.');
      }
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [anchor, filters, viewMode]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadEventsRef.current = loadEvents;
  }, [loadEvents]);

  useFocusEffect(useCallback(() => {
    if (!hasFocusedAgenda.current) {
      hasFocusedAgenda.current = true;
      return undefined;
    }

    void loadEventsRef.current?.('refresh');
    return undefined;
  }, []));

  useEffect(() => {
    let active = true;
    void agendaService.listResources()
      .then((result) => {
        if (active) setResources(result.resources);
      })
      .catch((reason: unknown) => {
        if (active) setResourcesError(reason instanceof Error ? reason.message : 'Não foi possível carregar os filtros.');
      });
    return () => {
      active = false;
    };
  }, []);

  function navigatePeriod(direction: 'prev' | 'next' | 'today') {
    const nextAnchor = direction === 'today'
      ? new Date()
      : viewMode === 'week'
        ? addDays(anchor, direction === 'prev' ? -7 : 7)
        : addMonths(anchor, direction === 'prev' ? -1 : 1);
    setAnchor(nextAnchor);
    setSelectedDateKey(direction === 'today' ? dateKey(nextAnchor) : dateKey(getAgendaRange(nextAnchor, viewMode).start));
  }

  function changeViewMode(nextViewMode: AgendaViewMode) {
    setViewMode(nextViewMode);
    setSelectedDateKey(dateKey(nextViewMode === 'week' ? getAgendaRange(anchor, 'week').start : anchor));
  }

  function selectDate(nextDateKey: string) {
    const nextDate = dateFromKey(nextDateKey);
    if (viewMode === 'month-detailed' && !isSameMonth(nextDate, anchor)) {
      setAnchor(nextDate);
    }
    setSelectedDateKey(nextDateKey);
  }

  function handleRequestEdit(event: CalendarEventDetails) {
    setSelectedEventId(null);
    router.push({ pathname: '/(app)/agenda/create', params: { eventId: event.id } });
  }

  function handleRequestAttendance(event: CalendarEventDetails) {
    setSelectedEventId(null);
    router.push({ pathname: '/(app)/agenda/attendance/[eventId]', params: { eventId: event.id } });
  }

  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <Screen
      scroll
      backgroundColor={colors.surface}
      refreshing={refreshing}
      onRefresh={() => void loadEvents('refresh')}
      style={styles.screen}
    >
      <PageHeader
        title="Agenda"
        onBack={() => router.back()}
        rightElement={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeFilters ? `Filtros da agenda, ${activeFilters} ativos` : 'Filtros da agenda'}
            onPress={() => setFiltersVisible(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.headerFilter, pressed ? styles.pressed : null]}
          >
            <FunnelIcon color={colors.brand} size={22} strokeWidth={1.8} />
            {activeFilters > 0 ? <View style={styles.filterBadge}><AppText variant="tiny" weight="bold" style={styles.filterBadgeText}>{activeFilters}</AppText></View> : null}
          </Pressable>
        )}
      />

      {resourcesError ? <View style={styles.inlineNotice}><AppText variant="tiny" tone="muted">Os filtros adicionais não estão disponíveis no momento.</AppText></View> : null}

      {loading && !hasLoadedData.current ? <AgendaSkeleton /> : error && !hasLoadedData.current ? <ErrorState title="Não foi possível carregar a agenda" message={error} actionLabel="Tentar novamente" onAction={() => void loadEvents()} /> : (
        <>
          {error ? <View style={styles.errorNotice}><AppText variant="small" tone="danger">{error}</AppText></View> : null}
          <AgendaCalendar
            anchor={anchor}
            selectedDateKey={selectedDateKey}
            viewMode={viewMode}
            events={events}
            timeZone={timeZone}
            onSelectDate={selectDate}
            onNavigate={navigatePeriod}
            onViewModeChange={changeViewMode}
            onEventPress={(event) => setSelectedEventId(event.id)}
            onCreate={() => router.push({ pathname: '/(app)/agenda/create', params: { date: selectedDateKey } })}
          />
        </>
      )}

      <AgendaFilterSheet
        visible={filtersVisible}
        filters={filters}
        resources={resources}
        onApply={setFilters}
        onClose={() => setFiltersVisible(false)}
      />
      <AgendaEventSheet
        visible={Boolean(selectedEventId)}
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
        onRefresh={() => void loadEvents('refresh')}
        onRequestEdit={handleRequestEdit}
        onRequestAttendance={handleRequestAttendance}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 116 },
  headerFilter: { position: 'relative', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  filterBadge: { position: 'absolute', top: -2, right: -4, minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderRadius: radius.pill, backgroundColor: colors.brand },
  filterBadgeText: { color: colors.white, fontSize: 9, lineHeight: 12 },
  inlineNotice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  errorNotice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.72 },
});
