import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import type { AgendaViewMode, CalendarEvent } from '../types/agenda';
import {
  addDays,
  dateFromKey,
  dateKey,
  dateKeyInTimeZone,
  dayLabel,
  getAgendaRange,
  getMonthGrid,
  isSameMonth,
  isToday,
  longDateLabel,
  minutesInTimeZone,
  periodLabel,
  timeInTimeZone,
} from '../utils/date';
import { colors, radius, spacing } from '@/theme/tokens';

const ROW_HEIGHT = 72;

export function AgendaCalendar({
  anchor,
  selectedDateKey,
  viewMode,
  events,
  timeZone,
  onSelectDate,
  onNavigate,
  onViewModeChange,
  onEventPress,
  onCreate,
}: {
  anchor: Date;
  selectedDateKey: string;
  viewMode: AgendaViewMode;
  events: CalendarEvent[];
  timeZone: string;
  onSelectDate: (_value: string) => void;
  onNavigate: (_direction: 'prev' | 'next' | 'today') => void;
  onViewModeChange: (_value: AgendaViewMode) => void;
  onEventPress: (_event: CalendarEvent) => void;
  onCreate: () => void;
}) {
  const range = getAgendaRange(anchor, viewMode);
  const days = viewMode === 'week' ? Array.from({ length: 7 }, (_, index) => addDays(range.start, index)) : getMonthGrid(anchor);
  const selectedDate = dateFromKey(selectedDateKey);
  const selectedEvents = useMemo(
    () => eventsForDate(events, selectedDateKey, timeZone),
    [events, selectedDateKey, timeZone],
  );

  return (
    <View style={styles.container}>
      <View style={styles.periodHeader}>
        <View style={styles.periodCopy}>
          <AppText variant="tiny" tone="muted" weight="medium" style={styles.eyebrow}>
            {viewMode === 'week' ? 'Esta semana' : 'Visão mensal'}
          </AppText>
          <AppText variant="subheading" weight="medium">{periodLabel(anchor, viewMode, timeZone)}</AppText>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Período anterior" hitSlop={4} onPress={() => onNavigate('prev')} style={({ pressed }) => [styles.circleButton, pressed ? styles.pressed : null]}>
            <ChevronLeftIcon color={colors.ink} size={20} strokeWidth={1.8} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Ir para hoje" hitSlop={4} onPress={() => onNavigate('today')} style={({ pressed }) => [styles.todayButton, pressed ? styles.pressed : null]}>
            <AppText variant="small" weight="medium">Hoje</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Próximo período" hitSlop={4} onPress={() => onNavigate('next')} style={({ pressed }) => [styles.circleButton, pressed ? styles.pressed : null]}>
            <ChevronRightIcon color={colors.ink} size={20} strokeWidth={1.8} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Criar evento" hitSlop={4} onPress={onCreate} style={({ pressed }) => [styles.addButton, pressed ? styles.pressed : null]}>
            <PlusIcon color={colors.white} size={23} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.viewToggle}>
        <Pressable accessibilityRole="tab" accessibilityLabel="Visualização semanal" accessibilityState={{ selected: viewMode === 'week' }} onPress={() => onViewModeChange('week')} style={[styles.viewOption, viewMode === 'week' ? styles.viewOptionActive : null]}>
          <AppText variant="small" weight="medium" style={viewMode === 'week' ? styles.activeText : undefined}>Semana</AppText>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityLabel="Visualização mensal" accessibilityState={{ selected: viewMode === 'month-detailed' }} onPress={() => onViewModeChange('month-detailed')} style={[styles.viewOption, viewMode === 'month-detailed' ? styles.viewOptionActive : null]}>
          <AppText variant="small" weight="medium" style={viewMode === 'month-detailed' ? styles.activeText : undefined}>Mês</AppText>
        </Pressable>
      </View>

      {viewMode === 'month-detailed' ? <MonthGrid days={days} anchor={anchor} selectedDateKey={selectedDateKey} events={events} timeZone={timeZone} onSelectDate={onSelectDate} /> : <WeekStrip days={days} selectedDateKey={selectedDateKey} events={events} timeZone={timeZone} onSelectDate={onSelectDate} />}

      <View style={styles.selectedHeader}>
        <View style={styles.selectedCopy}>
          <AppText variant="subheading" weight="medium">{capitalize(longDateLabel(selectedDate, timeZone))}</AppText>
          <AppText variant="small" tone="muted">
            {selectedEvents.length === 0 ? 'Nenhum compromisso neste dia' : `${selectedEvents.length} compromisso${selectedEvents.length === 1 ? '' : 's'}`}
          </AppText>
        </View>
      </View>

      <AgendaTimeline dateKeyValue={selectedDateKey} events={events} timeZone={timeZone} onEventPress={onEventPress} />
    </View>
  );
}

function WeekStrip({ days, selectedDateKey, events, timeZone, onSelectDate }: { days: Date[]; selectedDateKey: string; events: CalendarEvent[]; timeZone: string; onSelectDate: (_value: string) => void }) {
  return (
    <View style={styles.weekStrip}>
      {days.map((day) => {
        const key = dateKey(day);
        const selected = key === selectedDateKey;
        const hasEvents = eventsForDate(events, key, timeZone).length > 0;

        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Selecionar ${dayLabel(day, timeZone)} ${day.getDate()}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectDate(key)}
            style={[styles.weekDay, selected ? styles.weekDaySelected : null]}
          >
            <AppText variant="tiny" weight="medium" style={selected ? styles.activeText : undefined}>
              {dayLabel(day, timeZone)}
            </AppText>
            <View style={[styles.dayNumber, selected ? styles.dayNumberSelected : null]}>
              <AppText weight="medium" style={selected ? styles.activeNumber : undefined}>{day.getDate()}</AppText>
            </View>
            {hasEvents ? <View style={[styles.eventDot, selected ? styles.eventDotSelected : null]} /> : <View style={styles.eventDotPlaceholder} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthGrid({ days, anchor, selectedDateKey, events, timeZone, onSelectDate }: { days: Date[]; anchor: Date; selectedDateKey: string; events: CalendarEvent[]; timeZone: string; onSelectDate: (_value: string) => void }) {
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  return (
    <View style={styles.monthGrid}>
      <View style={styles.monthWeekdays}>
        {weekdays.map((day, index) => <AppText key={`${day}-${index}`} variant="tiny" tone="muted" weight="medium" style={styles.monthWeekday}>{day}</AppText>)}
      </View>
      <View style={styles.monthDays}>
        {days.map((day) => {
          const key = dateKey(day);
          const selected = key === selectedDateKey;
          const hasEvents = eventsForDate(events, key, timeZone).length > 0;

          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Selecionar dia ${day.getDate()}`}
              accessibilityState={{ selected }}
              onPress={() => onSelectDate(key)}
              style={[styles.monthDay, !isSameMonth(day, anchor) ? styles.monthDayOutside : null]}
            >
              <View style={[styles.monthDayNumber, selected ? styles.monthDayNumberSelected : null]}>
                <AppText variant="small" weight={selected || isToday(day) ? 'medium' : 'regular'} style={selected ? styles.activeNumber : undefined}>
                  {day.getDate()}
                </AppText>
              </View>
              {hasEvents ? <View style={[styles.eventDot, selected ? styles.eventDotSelected : null]} /> : <View style={styles.eventDotPlaceholder} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function eventsForDate(events: CalendarEvent[], key: string, timeZone: string) {
  return events.filter((event) => dateKeyInTimeZone(event.startAt, timeZone) === key).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

function AgendaTimeline({ dateKeyValue, events, timeZone, onEventPress }: { dateKeyValue: string; events: CalendarEvent[]; timeZone: string; onEventPress: (_event: CalendarEvent) => void }) {
  const { width } = useWindowDimensions();
  const dayEvents = eventsForDate(events, dateKeyValue, timeZone);
  const eventMinutes = dayEvents.flatMap((event) => [minutesInTimeZone(event.startAt, timeZone), minutesInTimeZone(event.endAt, timeZone)]);
  const first = eventMinutes.length ? Math.min(...eventMinutes) : 8 * 60;
  const last = eventMinutes.length ? Math.max(...eventMinutes) : 18 * 60;
  const startHour = Math.max(0, Math.min(8, Math.floor(first / 60) - 1));
  const endHour = Math.min(24, Math.max(20, Math.ceil(last / 60) + 1));
  const canvasHeight = Math.max(ROW_HEIGHT * (endHour - startHour), ROW_HEIGHT * 5);
  const eventAreaWidth = Math.max(width - spacing.xl * 2 - 78, 220);

  return (
    <ScrollView style={styles.timelineScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      <View style={[styles.timelineCanvas, { height: canvasHeight }]}>
        {Array.from({ length: endHour - startHour }, (_, index) => { const hour = startHour + index; return <View key={hour} style={[styles.timeRow, { top: index * ROW_HEIGHT }]}><AppText variant="tiny" tone="muted" style={styles.timeLabel}>{`${String(hour).padStart(2, '0')}:00`}</AppText><View style={styles.timeLine} /></View>; })}
        {dayEvents.map((event) => {
          const start = Math.max(startHour * 60, minutesInTimeZone(event.startAt, timeZone));
          const end = Math.max(start + 45, Math.min(endHour * 60, minutesInTimeZone(event.endAt, timeZone)));
          const top = ((start - startHour * 60) / 60) * ROW_HEIGHT;
          const height = Math.max(62, ((end - start) / 60) * ROW_HEIGHT);
          const status = event.status === 'REALIZADO' ? 'realizado' : event.status === 'CANCELADO' ? 'cancelado' : 'agendado';
          return <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Abrir ${event.title}, ${status}, das ${timeInTimeZone(event.startAt, timeZone)} às ${timeInTimeZone(event.endAt, timeZone)}`} onPress={() => onEventPress(event)} style={({ pressed }) => [styles.eventCard, { top, left: 64, width: eventAreaWidth, height }, event.status === 'CANCELADO' ? styles.eventCardCanceled : null, pressed ? styles.pressed : null]}><View style={[styles.eventAccent, { backgroundColor: event.status === 'REALIZADO' ? colors.success : event.status === 'CANCELADO' ? colors.danger : colors.brand }]} /><View style={styles.eventCopy}><AppText variant="small" weight="medium" numberOfLines={1}>{event.title}</AppText><AppText variant="tiny" tone="muted" numberOfLines={1}>{timeInTimeZone(event.startAt, timeZone)} – {timeInTimeZone(event.endAt, timeZone)}</AppText><AppText variant="tiny" tone="subtle" numberOfLines={1}>{[event.turma?.label, event.sala?.label].filter(Boolean).join(' · ') || 'Sem turma ou sala'}</AppText></View></Pressable>;
        })}
        {dayEvents.length === 0 ? <View style={styles.emptyTimeline}><AppText variant="small" tone="muted">Sua agenda está livre neste dia.</AppText></View> : null}
      </View>
    </ScrollView>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  periodHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  periodCopy: { flex: 1, gap: 2 },
  eyebrow: { letterSpacing: 0.2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  circleButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  todayButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  addButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  viewToggle: { flexDirection: 'row', padding: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  viewOption: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  viewOptionActive: { backgroundColor: colors.brandSoft },
  activeText: { color: colors.brand },
  activeNumber: { color: colors.white },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  weekDay: { minWidth: 38, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, borderRadius: radius.md },
  weekDaySelected: { backgroundColor: colors.brandSoft },
  dayNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  dayNumberSelected: { backgroundColor: colors.brand },
  eventDot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.brand },
  eventDotSelected: { backgroundColor: colors.brand },
  eventDotPlaceholder: { width: 5, height: 5 },
  monthGrid: { gap: spacing.sm },
  monthWeekdays: { flexDirection: 'row' },
  monthWeekday: { flex: 1, textAlign: 'center' },
  monthDays: { flexDirection: 'row', flexWrap: 'wrap' },
  monthDay: { width: `${100 / 7}%`, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md },
  monthDayOutside: { opacity: 0.42 },
  monthDayNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  monthDayNumberSelected: { backgroundColor: colors.brand },
  selectedHeader: { paddingTop: spacing.xs, paddingBottom: spacing.xs },
  selectedCopy: { gap: spacing.xs },
  timelineScroll: { maxHeight: 560, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  timelineCanvas: { position: 'relative', minWidth: '100%' },
  timeRow: { position: 'absolute', left: 0, right: 0, height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'flex-start', paddingTop: spacing.sm },
  timeLabel: { width: 56, paddingLeft: spacing.md },
  timeLine: { flex: 1, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eventCard: { position: 'absolute', flexDirection: 'row', overflow: 'hidden', borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  eventCardCanceled: { opacity: 0.68 },
  eventAccent: { width: 4 },
  eventCopy: { flex: 1, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.md },
  emptyTimeline: { position: 'absolute', top: 100, left: 64, right: spacing.lg, alignItems: 'center', padding: spacing.lg },
  pressed: { opacity: 0.72 },
});
