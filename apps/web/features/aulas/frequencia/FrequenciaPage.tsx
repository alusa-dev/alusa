'use client';

import { useState } from 'react';
import { TZDateMini } from '@date-fns/tz';
import { addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Filter, Search, Users } from '@/components/icons/icons';

import TableLayout from '@/components/layout/TableLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AttendanceHistoryTurmaItemDTO,
  AttendanceWorkspaceLaunchStateDTO,
  AttendanceWorkspaceTurmaItemDTO,
} from '@/features/aulas/dtos';
import { AttendanceHistoryTurmaDialog } from '@/features/aulas/frequencia/components/AttendanceHistoryTurmaDialog';
import { AttendanceTurmaDialog } from '@/features/aulas/frequencia/components/AttendanceTurmaDialog';
import { useAttendance } from '@/features/aulas/frequencia/hooks/use-attendance';
import { useAttendanceWorkspace } from '@/features/aulas/frequencia/hooks/use-attendance-workspace';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  endOfZonedDayClient,
  formatInstantInAccountZone,
  normalizeAccountTimeZoneClient,
  startOfZonedDayClient,
  zonedNaiveToUtcIso,
} from '@/lib/agenda-timezone';

const ALL = '__ALL__';
const tzDefault = DEFAULT_ACCOUNT_TIMEZONE;
const zNowDefault = new TZDateMini(Date.now(), tzDefault);
const DEFAULT_START = startOfZonedDayClient(new Date(addDays(zNowDefault, -30).getTime()), tzDefault).toISOString();
const DEFAULT_END = endOfZonedDayClient(new Date(addDays(zNowDefault, 30).getTime()), tzDefault).toISOString();
const TOOLBAR_TRIGGER_CLASS = 'h-9 rounded-xl border-slate-200 bg-white';

function toZonedDateInputValue(value: string | undefined, timeZone: string) {
  if (!value) return '';
  return formatInstantInAccountZone(value, 'yyyy-MM-dd', timeZone);
}

function getLaunchStateBadgeVariant(state: AttendanceWorkspaceLaunchStateDTO) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 'info';
    case 'PENDENTE':
      return 'warning';
    case 'REALIZADA':
      return 'success';
    case 'FUTURA':
      return 'default';
    default:
      return 'neutral';
  }
}

function getLaunchStateLabel(state: AttendanceWorkspaceLaunchStateDTO) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 'Em andamento';
    case 'PENDENTE':
      return 'Pendente';
    case 'REALIZADA':
      return 'Realizada';
    case 'FUTURA':
      return 'Futura';
    case 'CANCELADA':
      return 'Cancelada';
    default:
      return 'Sem aula';
  }
}

function AttendanceHistoryRow({
  item,
  onSelect,
  timeZone,
}: {
  item: AttendanceHistoryTurmaItemDTO;
  onSelect: (_turmaId: string) => void;
  timeZone: string;
}) {
  return (
    <button
      type="button"
      onClick={() => item.turma && onSelect(item.turma.id)}
      className="grid w-full gap-4 border-b border-slate-100 px-6 py-4 text-left transition-colors hover:bg-slate-50 md:grid-cols-[1.5fr_1fr_1fr_auto]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900">{item.turma?.label ?? 'Turma sem vínculo'}</div>
        <div className="mt-1 text-xs text-slate-500">
          Última frequência:{' '}
          {formatInstantInAccountZone(item.lastLaunchedAt, "dd/MM/yyyy 'às' HH:mm", timeZone, { locale: ptBR })}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Professor(es)</div>
        <div className="mt-1 truncate text-sm text-slate-700">
          {item.professores.map((professor) => professor.label).join(', ') || 'Sem professor'}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Resumo do período</div>
        <div className="mt-1 text-sm text-slate-700">
          {item.summary.recorded} lançamentos • {item.summary.presentes} presentes • {item.summary.faltas} faltas
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-end">
        <Badge variant="info">{item.occurrenceCount} ocorrência(s)</Badge>
        <span className="text-xs font-medium text-slate-400">Abrir histórico</span>
      </div>
    </button>
  );
}

function AttendanceTurmaCard({
  item,
  onSelect,
  timeZone,
}: {
  item: AttendanceWorkspaceTurmaItemDTO;
  onSelect: (_turmaId: string) => void;
  timeZone: string;
}) {
  const occurrence = item.selectedOccurrence;

  return (
    <Card className="h-full rounded-2xl border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onSelect(item.turma.id)}
        className="flex h-full w-full flex-col text-left"
      >
        <CardHeader className="space-y-2 border-b border-slate-100 p-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-xl font-semibold leading-tight text-slate-900">
                {item.turma.label}
              </CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                {item.professores.map((professor) => professor.label).join(', ') || 'Sem professor vinculado'}
              </p>
            </div>
            <Badge variant={getLaunchStateBadgeVariant(item.launchState)}>
              {getLaunchStateLabel(item.launchState)}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5 pt-4">
          <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:grid-cols-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Horário</div>
              <div className="mt-1.5 text-sm font-semibold text-slate-900">
                {occurrence
                  ? `${formatInstantInAccountZone(occurrence.startAt, 'HH:mm', timeZone)} - ${formatInstantInAccountZone(occurrence.endAt, 'HH:mm', timeZone)}`
                  : 'Sem aula'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Sala</div>
              <div className="mt-1.5 text-sm text-slate-700">
                {occurrence?.sala?.label ?? item.sala?.label ?? 'Sem sala'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Chamada</div>
              <div className="mt-1.5 text-sm font-semibold text-slate-900">
                {occurrence
                  ? `${occurrence.attendanceSummary.recorded}/${occurrence.attendanceSummary.totalEligible}`
                  : 'Sem ocorrência'}
              </div>
            </div>
          </div>
        </CardContent>
      </button>
    </Card>
  );
}

function AttendanceHistoryToolbar({
  filters,
  setFilters,
  resources,
  timeZone,
}: {
  filters: ReturnType<typeof useAttendance>['filters'];
  setFilters: ReturnType<typeof useAttendance>['setFilters'];
  resources: { turmas: Array<{ id: string; label: string }>; professores: Array<{ id: string; label: string }> };
  timeZone: string;
}) {
  const activeFilters = [
    Boolean(filters.turmaId),
    Boolean(filters.professorId),
    Boolean(filters.startDate),
    Boolean(filters.endDate),
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 rounded-xl border-slate-200 px-3">
              <Filter className="mr-2 h-4 w-4" />
              {activeFilters > 0 ? `Filtros (${activeFilters})` : 'Filtros'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px] rounded-2xl border-slate-200 p-4">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Filtros do histórico</div>
                <div className="mt-1 text-xs text-slate-500">
                  Refine o histórico por turma, professor e período.
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Turma
                  </label>
                  <Select
                    value={filters.turmaId ?? ALL}
                    onValueChange={(value) =>
                      setFilters((current) => ({ ...current, turmaId: value === ALL ? undefined : value }))
                    }
                  >
                    <SelectTrigger className={TOOLBAR_TRIGGER_CLASS}>
                      <SelectValue placeholder="Turma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as turmas</SelectItem>
                      {resources.turmas.map((turma) => (
                        <SelectItem key={turma.id} value={turma.id}>
                          {turma.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Professor
                  </label>
                  <Select
                    value={filters.professorId ?? ALL}
                    onValueChange={(value) =>
                      setFilters((current) => ({
                        ...current,
                        professorId: value === ALL ? undefined : value,
                      }))
                    }
                  >
                    <SelectTrigger className={TOOLBAR_TRIGGER_CLASS}>
                      <SelectValue placeholder="Professor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todos os professores</SelectItem>
                      {resources.professores.map((professor) => (
                        <SelectItem key={professor.id} value={professor.id}>
                          {professor.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Início
                    </label>
                    <Input
                      type="date"
                      value={toZonedDateInputValue(filters.startDate, timeZone)}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          startDate: event.target.value
                            ? zonedNaiveToUtcIso(`${event.target.value}T00:00`, timeZone)
                            : undefined,
                        }))
                      }
                      className="h-9 rounded-xl border-slate-200"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Fim
                    </label>
                    <Input
                      type="date"
                      value={toZonedDateInputValue(filters.endDate, timeZone)}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          endDate: event.target.value
                            ? endOfZonedDayClient(
                                new Date(zonedNaiveToUtcIso(`${event.target.value}T00:00`, timeZone)),
                                timeZone,
                              ).toISOString()
                            : undefined,
                        }))
                      }
                      className="h-9 rounded-xl border-slate-200"
                    />
                  </div>
                </div>
              </div>

              {activeFilters > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-slate-500 hover:text-slate-900"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      turmaId: undefined,
                      professorId: undefined,
                      startDate: undefined,
                      endDate: undefined,
                    }))
                  }
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function AttendanceHistoryContent({
  filters,
  data,
  loading,
  error,
  selectedTurmaId,
  onSelectedTurmaIdChange,
  timeZone,
}: {
  filters: ReturnType<typeof useAttendance>['filters'];
  data: ReturnType<typeof useAttendance>['data'];
  loading: boolean;
  error: string | null;
  selectedTurmaId: string | null;
  onSelectedTurmaIdChange: (_value: string | null) => void;
  timeZone: string;
}) {
  const items = data?.data.items ?? [];

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Histórico por turma</h2>
            <p className="mt-1 text-xs text-slate-500">
              Selecione a turma para abrir as frequências já lançadas no período.
            </p>
          </div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {items.length} turma(s)
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Carregando histórico...</div>
        ) : items.length === 0 ? (
          <div className="m-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
            Nenhum registro encontrado.
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <AttendanceHistoryRow
                key={item.turma?.id ?? item.lastLaunchedAt}
                item={item}
                onSelect={onSelectedTurmaIdChange}
                timeZone={timeZone}
              />
            ))}
          </div>
        )}
      </div>

      <AttendanceHistoryTurmaDialog
        open={Boolean(selectedTurmaId)}
        turmaId={selectedTurmaId}
        filters={filters}
        onOpenChange={(open) => {
          if (!open) onSelectedTurmaIdChange(null);
        }}
      />
    </div>
  );
}

export function FrequenciaPage() {
  const [view, setView] = useState<'workspace' | 'history'>('workspace');
  const [selectedTurmaId, setSelectedTurmaId] = useState<string | null>(null);
  const {
    filters: historyFilters,
    setFilters: setHistoryFilters,
    data: historyData,
    loading: historyLoading,
    error: historyError,
  } = useAttendance({
    startDate: DEFAULT_START,
    endDate: DEFAULT_END,
  });
  const {
    selectedDate,
    setSelectedDate,
    search,
    setSearch,
    data,
    loading,
    error,
    refresh,
  } = useAttendanceWorkspace();

  const workspace = data?.data;
  const historyResources = historyData?.data.resources ?? { turmas: [], professores: [] };
  const workspaceTz = normalizeAccountTimeZoneClient(workspace?.timeZone);
  const historyTz = normalizeAccountTimeZoneClient(historyData?.data.timeZone);

  return (
    <TableLayout
      title="Frequência"
      subtitle="Lance a chamada por turma e navegue entre datas sem sair do padrão operacional da Alusa."
      className="pr-4 xl:pr-6"
    >
      <div className="space-y-5">
        <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
          <Tabs value={view} onValueChange={(value) => setView(value as 'workspace' | 'history')}>
            <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <TabsList className="h-9">
                  <TabsTrigger value="workspace" className="px-4 text-xs">
                    Lançar frequência
                  </TabsTrigger>
                  <TabsTrigger value="history" className="px-4 text-xs">
                    Histórico
                  </TabsTrigger>
                </TabsList>

                {view === 'workspace' && workspace?.professorScope.active ? (
                  <Badge variant="info">
                    {workspace.professorScope.label
                      ? `Turmas de ${workspace.professorScope.label}`
                      : 'Escopo do professor'}
                  </Badge>
                ) : null}
              </div>

              {view === 'workspace' ? (
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
                  <div className="relative w-full xl:w-[360px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar turma"
                      className="h-9 rounded-xl border-slate-200 pl-9"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium capitalize text-slate-900 shadow-sm">
                      {formatInstantInAccountZone(selectedDate, "dd 'de' MMMM", workspaceTz, { locale: ptBR })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl border-slate-200"
                      onClick={() =>
                        setSelectedDate(startOfZonedDayClient(new Date(), workspaceTz).toISOString())
                      }
                    >
                      Hoje
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-xl border-slate-200"
                      onClick={() => {
                        const z = new TZDateMini(new Date(selectedDate).getTime(), workspaceTz);
                        const shifted = addDays(z, -1);
                        setSelectedDate(
                          startOfZonedDayClient(new Date(shifted.getTime()), workspaceTz).toISOString(),
                        );
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-xl border-slate-200"
                      onClick={() => {
                        const z = new TZDateMini(new Date(selectedDate).getTime(), workspaceTz);
                        const shifted = addDays(z, 1);
                        setSelectedDate(
                          startOfZonedDayClient(new Date(shifted.getTime()), workspaceTz).toISOString(),
                        );
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <AttendanceHistoryToolbar
                  filters={historyFilters}
                  setFilters={setHistoryFilters}
                  resources={historyResources}
                  timeZone={historyTz}
                />
              )}
            </div>
          </Tabs>
        </Card>

        {view === 'workspace' ? (
          <>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {workspace?.professorScope.reason === 'PROFESSOR_NOT_LINKED' ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {workspace.professorScope.message}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Turmas operacionais</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Escolha uma turma para lançar a chamada do dia e manter a frequência sempre em dia.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                <Users className="h-3.5 w-3.5" />
                {workspace?.items.length ?? 0} turma(s)
              </div>
            </div>

            {loading ? (
              <div className="px-6 py-10 text-sm text-slate-500">Carregando turmas...</div>
            ) : workspace?.items.length ? (
              <div className="grid gap-6 p-6 md:grid-cols-2 2xl:grid-cols-3">
                {workspace.items.map((item) => (
                  <AttendanceTurmaCard
                    key={item.turma.id}
                    item={item}
                    onSelect={setSelectedTurmaId}
                    timeZone={workspaceTz}
                  />
                ))}
              </div>
            ) : (
              <div className="m-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
                Nenhuma turma encontrada para a data e busca selecionadas.
              </div>
            )}
          </div>

          <AttendanceTurmaDialog
            open={Boolean(selectedTurmaId)}
            turmaId={selectedTurmaId}
            initialDate={selectedDate}
            onOpenChange={(open) => {
              if (!open) setSelectedTurmaId(null);
            }}
            onSaved={refresh}
          />
          </>
        ) : (
          <AttendanceHistoryContent
            filters={historyFilters}
            data={historyData}
            loading={historyLoading}
            error={historyError}
            selectedTurmaId={selectedTurmaId}
            onSelectedTurmaIdChange={setSelectedTurmaId}
            timeZone={historyTz}
          />
        )}
      </div>
    </TableLayout>
  );
}
