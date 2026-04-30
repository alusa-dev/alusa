'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { differenceInCalendarDays, eachDayOfInterval, endOfDay, format, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type { CalendarEventListItemDTO, TimelineGroupByDTO } from '@/features/aulas/dtos';
import {
  getCalendarEventCardTone,
} from '@/features/aulas/utils/calendar-event-state';
import { cn } from '@/lib/utils';

type TimelineSchedulerProps = {
  events: CalendarEventListItemDTO[];
  start: string;
  end: string;
  groupBy: TimelineGroupByDTO;
  onEventSelect: (_eventId: string) => void;
};

type GroupedEntry = {
  key: string;
  label: string;
  events: CalendarEventListItemDTO[];
};

type TimelineLayoutItem = {
  event: CalendarEventListItemDTO;
  left: number;
  renderWidth: number;
  lane: number;
};

type TimelineScale = {
  hourWidth: number;
  minorTickMinutes: number;
  labelStepMinutes: number;
  minEventWidth: number;
  leadPadding: number;
};

const COLOR_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'border-purple-200 bg-purple-50 text-brand-accent hover:bg-purple-100/60',
  REPOSICAO: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/60',
  EVENTO_INTERNO: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/60',
  EVENTO_EXTERNO: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100/60',
  WORKSHOP: 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100/60',
  FERIADO: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100/60',
  PAUSA: 'border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100/60',
  CANCELAMENTO: 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100/60',
  SUBSTITUICAO: 'border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100/60',
};

const TIMELINE_START_HOUR = 0;
const TIMELINE_END_HOUR = 24;
const MINUTES_PER_DAY = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;
const RESOURCE_COL_W = 240;

const LANE_HEIGHT = 38;
const LANE_GAP = 6;
const ROW_PADDING_Y = 12;
const SINGLE_LANE_INSET = 1;
const EMPTY_ROW_HEIGHT = 72;

const HEADER_HEIGHT = 86;
const DAY_HEADER_HEIGHT = 48;
const TIME_HEADER_HEIGHT = HEADER_HEIGHT - DAY_HEADER_HEIGHT;

function getTimelineScale(dayCount: number): TimelineScale {
  if (dayCount <= 1) {
    return {
      hourWidth: 192,
      minorTickMinutes: 30,
      labelStepMinutes: 30,
      minEventWidth: 192,
      leadPadding: 288,
    };
  }

  if (dayCount <= 7) {
    return {
      hourWidth: 96,
      minorTickMinutes: 60,
      labelStepMinutes: 120,
      minEventWidth: 160,
      leadPadding: 240,
    };
  }

  return {
    hourWidth: 52,
    minorTickMinutes: 120,
    labelStepMinutes: 240,
    minEventWidth: 132,
    leadPadding: 208,
  };
}

function buildGroups(events: CalendarEventListItemDTO[], groupBy: TimelineGroupByDTO): GroupedEntry[] {
  const map = new Map<string, GroupedEntry>();

  const ensureGroup = (key: string, label: string) => {
    if (!map.has(key)) {
      map.set(key, { key, label, events: [] });
    }
    return map.get(key)!;
  };

  for (const event of events) {
    if (groupBy === 'turma') {
      const turma = event.turma ?? { id: 'sem-turma', label: 'Sem turma' };
      ensureGroup(turma.id, turma.label).events.push(event);
      continue;
    }

    if (groupBy === 'sala') {
      const sala = event.sala ?? { id: 'sem-sala', label: 'Sem sala' };
      ensureGroup(sala.id, sala.label).events.push(event);
      continue;
    }

    if (!event.professores.length) {
      ensureGroup('sem-professor', 'Sem professor').events.push(event);
      continue;
    }

    event.professores.forEach((professor) => {
      ensureGroup(professor.id, professor.nome).events.push(event);
    });
  }

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function getMinutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function getDayWidth(scale: TimelineScale) {
  return (MINUTES_PER_DAY / 60) * scale.hourWidth;
}

function getTimelineOffset(
  date: Date,
  rangeStart: Date,
  dayCount: number,
  dayWidth: number,
  hourWidth: number,
) {
  const dayIndex = differenceInCalendarDays(startOfDay(date), rangeStart);

  if (dayIndex < 0 || dayIndex >= dayCount) {
    return null;
  }

  const minutes = Math.max(
    TIMELINE_START_HOUR * 60,
    Math.min(TIMELINE_END_HOUR * 60, getMinutesOfDay(date)),
  );

  return dayIndex * dayWidth + (minutes / 60) * hourWidth;
}

function getTimelinePlacement(
  event: CalendarEventListItemDTO,
  rangeStart: Date,
  dayCount: number,
  dayWidth: number,
  scale: TimelineScale,
) {
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);
  const eventDayStart = startOfDay(eventStart);
  const eventEndDayStart = startOfDay(eventEnd);
  const dayIndex = differenceInCalendarDays(eventDayStart, rangeStart);

  if (dayIndex < 0 || dayIndex >= dayCount) return null;

  const clampedStartMinutes = Math.max(TIMELINE_START_HOUR * 60, getMinutesOfDay(eventStart));
  const rawEndMinutes =
    differenceInCalendarDays(eventEndDayStart, eventDayStart) > 0
      ? TIMELINE_END_HOUR * 60
      : Math.max(getMinutesOfDay(eventEnd), clampedStartMinutes + 30);
  const clampedEndMinutes = Math.min(TIMELINE_END_HOUR * 60, rawEndMinutes);

  if (clampedEndMinutes <= clampedStartMinutes) return null;

  const dayOffset = dayIndex * dayWidth;
  const left = getTimelineOffset(eventStart, rangeStart, dayCount, dayWidth, scale.hourWidth);

  if (left === null) return null;

  const rawWidth = ((clampedEndMinutes - clampedStartMinutes) / 60) * scale.hourWidth;
  const maxWithinDay = dayWidth - (left - dayOffset);
  const renderWidth = Math.min(Math.max(rawWidth, scale.minEventWidth), maxWithinDay);

  return { left, renderWidth, startTime: eventStart.getTime() };
}

function buildTimelineLayout(
  events: CalendarEventListItemDTO[],
  rangeStart: Date,
  dayCount: number,
  dayWidth: number,
  scale: TimelineScale,
) {
  const positionedEvents = events
    .map((event) => {
      const placement = getTimelinePlacement(event, rangeStart, dayCount, dayWidth, scale);
      return placement ? { event, ...placement } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.left !== b.left) return a.left - b.left;
      return a.event.title.localeCompare(b.event.title, 'pt-BR');
    });

  const laneEnds: number[] = [];
  const items: TimelineLayoutItem[] = [];

  for (const item of positionedEvents) {
    let lane = laneEnds.findIndex((end) => end <= item.left);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.left + item.renderWidth);
    } else {
      laneEnds[lane] = item.left + item.renderWidth;
    }

    items.push({ event: item.event, left: item.left, renderWidth: item.renderWidth, lane });
  }

  return { items, laneCount: Math.max(laneEnds.length, 1) };
}

function buildRowHeight(laneCount: number) {
  return Math.max(
    EMPTY_ROW_HEIGHT,
    ROW_PADDING_Y * 2 + laneCount * LANE_HEIGHT + Math.max(0, laneCount - 1) * LANE_GAP,
  );
}

type TimelineGridProps = {
  days: Date[];
  dayWidth: number;
  scale: TimelineScale;
  timelineWidth: number;
  height: number;
  showDayLabels?: boolean;
};

function TimelineGrid({
  days,
  dayWidth,
  scale,
  timelineWidth,
  height,
  showDayLabels = false,
}: TimelineGridProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const gridLineTop = showDayLabels ? DAY_HEADER_HEIGHT : 0;
  const gridLineHeight = showDayLabels ? Math.max(height - DAY_HEADER_HEIGHT, 0) : height;
  const timeLabelTop = DAY_HEADER_HEIGHT + 8;
  const timeLabelWidth = Math.max((scale.labelStepMinutes / 60) * scale.hourWidth - 4, 40);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="relative" style={{ width: `${timelineWidth}px`, height: `${height}px` }}>
        {days.map((day, dayIndex) => {
          const dayOffset = dayIndex * dayWidth;
          const isToday = format(day, 'yyyy-MM-dd') === today;
          const dayLabel = format(day, 'EEE dd/MM', { locale: ptBR })
            .replace('-feira', '')
            .toUpperCase();

          return (
            <Fragment key={day.toISOString()}>
              <div
                className={cn(
                  'absolute border-l',
                  dayIndex === 0 ? 'border-transparent' : 'border-slate-200',
                )}
                style={{ left: `${dayOffset}px`, top: `${gridLineTop}px`, height: `${gridLineHeight}px` }}
              />

              {dayIndex === days.length - 1 ? (
                <div
                  className="absolute border-r border-slate-200"
                  style={{ left: `${dayOffset + dayWidth}px`, top: `${gridLineTop}px`, height: `${gridLineHeight}px` }}
                />
              ) : null}

              {showDayLabels ? (
                <div
                  className={cn(
                    'absolute flex items-center whitespace-nowrap px-3 leading-none',
                    'text-[11px] font-bold uppercase tracking-[0.16em]',
                    isToday ? 'text-brand-accent' : 'text-slate-500',
                  )}
                  style={{
                    left: `${dayOffset}px`,
                    width: `${dayWidth}px`,
                    top: 0,
                    height: `${DAY_HEADER_HEIGHT}px`,
                  }}
                >
                  {dayLabel}
                </div>
              ) : null}

              {showDayLabels
                ? Array.from(
                    { length: Math.ceil(MINUTES_PER_DAY / scale.labelStepMinutes) },
                    (_, index) => index * scale.labelStepMinutes,
                  ).map((minutes) => {
                    const labelHour = Math.floor(minutes / 60);
                    const labelMinute = minutes % 60;

                    return (
                      <span
                        key={`${day.toISOString()}-label-${minutes}`}
                        className="absolute select-none truncate px-1 text-[9px] font-semibold tabular-nums text-slate-400"
                        style={{
                          left: `${dayOffset + (minutes / 60) * scale.hourWidth + 2}px`,
                          top: `${timeLabelTop}px`,
                          width: `${timeLabelWidth}px`,
                        }}
                      >
                        {String(labelHour).padStart(2, '0')}:{String(labelMinute).padStart(2, '0')}
                      </span>
                    );
                  })
                : null}

              {Array.from(
                { length: Math.ceil(MINUTES_PER_DAY / scale.minorTickMinutes) },
                (_, index) => (index + 1) * scale.minorTickMinutes,
              )
                .filter((minutes) => minutes < MINUTES_PER_DAY)
                .map((minutes) => {
                  const tickOffset = dayOffset + (minutes / 60) * scale.hourWidth;
                  const isHourMark = minutes % 60 === 0;

                  return (
                    <div
                      key={`${day.toISOString()}-tick-${minutes}`}
                      className={cn(
                        'absolute border-l',
                        isHourMark ? 'border-slate-100' : 'border-slate-50',
                      )}
                      style={{ left: `${tickOffset}px`, top: `${gridLineTop}px`, height: `${gridLineHeight}px` }}
                    />
                  );
                })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function TimelineScheduler({
  events,
  start,
  end,
  groupBy,
  onEventSelect,
}: TimelineSchedulerProps) {
  const rangeStart = startOfDay(new Date(start));
  const days = eachDayOfInterval({ start: rangeStart, end: endOfDay(new Date(end)) });
  const scale = getTimelineScale(days.length);
  const dayWidth = getDayWidth(scale);
  const timelineWidth = days.length * dayWidth;
  const groups = buildGroups(events, groupBy);
  const [now, setNow] = useState(() => new Date());

  const groupLabel = groupBy === 'professor' ? 'Professor' : groupBy === 'sala' ? 'Sala' : 'Turma';
  const showGroupEventCount = groupBy !== 'turma';

  const cardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; label: string } | null>(null);

  const nowOffset = getTimelineOffset(now, rangeStart, days.length, dayWidth, scale.hourWidth);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (nowOffset !== null) {
      container.scrollLeft = Math.max(0, nowOffset - scale.leadPadding);
      return;
    }

    if (!events.length) return;

    let minX = Infinity;

    for (const event of events) {
      const eventOffset = getTimelineOffset(
        new Date(event.startAt),
        rangeStart,
        days.length,
        dayWidth,
        scale.hourWidth,
      );

      if (eventOffset === null) continue;
      if (eventOffset < minX) minX = eventOffset;
    }

    if (minX === Infinity) return;

    container.scrollLeft = Math.max(0, minX - scale.leadPadding);
  }, [dayWidth, days.length, events, nowOffset, rangeStart, scale.hourWidth, scale.leadPadding]);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const canvasX = rawX - RESOURCE_COL_W;

    if (canvasX < 0 || canvasX > timelineWidth) {
      setCursor(null);
      return;
    }

    const hoveredDayIndex = Math.max(0, Math.min(days.length - 1, Math.floor(canvasX / dayWidth)));
    const minutesWithinDay = canvasX - hoveredDayIndex * dayWidth;
    const totalMinutes = Math.max(
      TIMELINE_START_HOUR * 60,
      Math.min(TIMELINE_END_HOUR * 60 - 1, (minutesWithinDay / scale.hourWidth) * 60),
    );
    const hh = Math.floor(totalMinutes / 60);
    const mm = Math.floor(totalMinutes % 60);
    const timeLabel = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const label =
      days.length > 1
        ? `${format(days[hoveredDayIndex], 'dd/MM')} ${timeLabel}`
        : timeLabel;

    setCursor({ x: rawX, label });
  }

  function handleMouseLeave() {
    setCursor(null);
  }

  if (!groups.length) {
    return (
      <div className="px-6 py-14 text-center text-sm text-slate-400">
        Nenhum evento encontrado no período para exibir na timeline.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto">
      <div style={{ minWidth: `${RESOURCE_COL_W + timelineWidth}px` }}>
        <div
          ref={cardRef}
          className="relative overflow-hidden rounded-xl border border-slate-200 bg-white"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {nowOffset !== null ? (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-brand-accent/70"
                style={{ left: `${RESOURCE_COL_W + nowOffset}px`, zIndex: 5 }}
              />
              <div
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-brand-accent shadow-sm"
                style={{ left: `${RESOURCE_COL_W + nowOffset}px`, top: `${HEADER_HEIGHT - 5}px`, zIndex: 6 }}
              />
              <div
                className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded-full bg-brand-accent px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white shadow-md"
                style={{ left: `${RESOURCE_COL_W + nowOffset}px`, zIndex: 7 }}
              >
                {format(now, 'HH:mm')}
              </div>
            </>
          ) : null}

          {cursor ? (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-brand-accent/40"
                style={{ left: `${cursor.x}px`, zIndex: 6 }}
              />
              <div
                className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded-full bg-brand-accent px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white shadow-md"
                style={{ left: `${cursor.x}px`, zIndex: 7 }}
              >
                {cursor.label}
              </div>
            </>
          ) : null}

          <div
            className="grid border-b border-slate-200 bg-slate-50/80"
            style={{ gridTemplateColumns: `${RESOURCE_COL_W}px ${timelineWidth}px` }}
          >
            <div
              className="sticky left-0 z-20 flex flex-col border-r border-slate-200 bg-slate-50/80"
              style={{ height: `${HEADER_HEIGHT}px` }}
            >
              <div
                className="flex items-center border-b border-slate-100 px-4"
                style={{ height: `${DAY_HEADER_HEIGHT}px` }}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  {groupLabel}
                </span>
              </div>
              <div className="flex items-center px-4" style={{ height: `${TIME_HEADER_HEIGHT}px` }}>
                <span className="text-[11px] font-semibold text-slate-400">
                  {String(TIMELINE_START_HOUR).padStart(2, '0')}h - {String(TIMELINE_END_HOUR).padStart(2, '0')}h
                </span>
              </div>
            </div>

            <div className="relative overflow-hidden" style={{ height: `${HEADER_HEIGHT}px` }}>
              <div
                className="absolute left-0 right-0 border-b border-slate-100"
                style={{ top: `${DAY_HEADER_HEIGHT}px` }}
              />
              <TimelineGrid
                days={days}
                dayWidth={dayWidth}
                scale={scale}
                timelineWidth={timelineWidth}
                height={HEADER_HEIGHT}
                showDayLabels
              />
            </div>
          </div>

          {groups.map((group, groupIndex) => {
            const layout = buildTimelineLayout(group.events, rangeStart, days.length, dayWidth, scale);
            const rowHeight = buildRowHeight(layout.laneCount);
            const isLast = groupIndex === groups.length - 1;

            return (
              <div
                key={group.key}
                className={cn('grid bg-white', !isLast && 'border-b border-slate-100')}
                style={{ gridTemplateColumns: `${RESOURCE_COL_W}px ${timelineWidth}px` }}
              >
                <div
                  className="sticky left-0 z-10 flex flex-col justify-center border-r border-slate-200 bg-white px-4"
                  style={{ height: `${rowHeight}px` }}
                >
                  <div className="truncate text-sm font-medium leading-5 text-slate-800">
                    {group.label}
                  </div>
                  {showGroupEventCount ? (
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {group.events.length === 0
                        ? 'Sem eventos'
                        : `${group.events.length} evento${group.events.length !== 1 ? 's' : ''}`}
                    </div>
                  ) : null}
                </div>

                <div className="relative overflow-hidden bg-white" style={{ height: `${rowHeight}px` }}>
                  <TimelineGrid
                    days={days}
                    dayWidth={dayWidth}
                    scale={scale}
                    timelineWidth={timelineWidth}
                    height={rowHeight}
                  />

                  {layout.items.map((item) => {
                    const hasConflict = item.event.conflicts.length > 0;
                    const fillsEntireRow = layout.laneCount === 1;
                    const cardTone = getCalendarEventCardTone(item.event);

                    return (
                      <button
                        key={item.event.id}
                        type="button"
                        onClick={() => onEventSelect(item.event.id)}
                        data-testid="timeline-event-card"
                        data-event-id={item.event.id}
                        className={cn(
                          'absolute flex flex-col justify-center overflow-hidden rounded-lg border px-2.5 py-1 text-left text-[11px] leading-[1.35] transition-colors cursor-pointer',
                          hasConflict
                            ? 'border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200/80'
                            : (COLOR_BY_TYPE[item.event.type] ?? COLOR_BY_TYPE.AULA),
                          !hasConflict && cardTone === 'in_progress' && 'ring-1 ring-inset ring-brand-accent/20',
                          !hasConflict && cardTone === 'past' && 'border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/80',
                          !hasConflict && cardTone === 'completed' && 'border-emerald-300 bg-emerald-100/80 text-emerald-900 hover:bg-emerald-100',
                          !hasConflict && cardTone === 'cancelled' && 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200/80',
                        )}
                        style={{
                          left: `${item.left + 2}px`,
                          top: fillsEntireRow
                            ? `${SINGLE_LANE_INSET}px`
                            : `${ROW_PADDING_Y + item.lane * (LANE_HEIGHT + LANE_GAP)}px`,
                          width: `${Math.max(item.renderWidth - 4, 48)}px`,
                          height: fillsEntireRow
                            ? `${rowHeight - SINGLE_LANE_INSET * 2}px`
                            : `${LANE_HEIGHT}px`,
                          zIndex: item.lane + 1,
                        }}
                      >
                        <div className="truncate font-medium">
                          {format(new Date(item.event.startAt), 'HH:mm')}
                          {' - '}
                          {format(new Date(item.event.endAt), 'HH:mm')}
                        </div>
                        <div className="truncate text-[10px] opacity-80">{item.event.title}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
