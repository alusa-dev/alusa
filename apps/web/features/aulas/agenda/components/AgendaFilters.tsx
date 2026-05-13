'use client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AulasLookupItemDTO, CalendarEventTypeDTO } from '@/features/aulas/dtos';
import { CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/aulas/types';
import type { AgendaFiltersState } from '@/features/aulas/agenda/hooks/use-agenda';
import { ChevronLeft, ChevronRight, Filter } from '@/components/icons/icons';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatInstantInAccountZone,
} from '@/lib/agenda-timezone';

type AgendaFiltersProps = {
  filters: AgendaFiltersState;
  resources: {
    turmas: AulasLookupItemDTO[];
    professores: AulasLookupItemDTO[];
    salas: AulasLookupItemDTO[];
  };
  /** IANA — rótulo do período alinhado ao fuso da escola */
  timeZone?: string;
  onFiltersChange: (_patch: Partial<AgendaFiltersState>) => void;
  onNavigatePeriod: (_direction: 'prev' | 'next' | 'today') => void;
  embedded?: boolean;
  showCurrentLabel?: boolean;
};

const ALL = '__ALL__';

export function AgendaFilters({
  filters,
  resources,
  timeZone = DEFAULT_ACCOUNT_TIMEZONE,
  onFiltersChange,
  onNavigatePeriod,
  embedded = false,
  showCurrentLabel = true,
}: AgendaFiltersProps) {
  const currentLabel = `${formatInstantInAccountZone(filters.start, 'dd/MM', timeZone)} - ${formatInstantInAccountZone(
    filters.end,
    'dd/MM',
    timeZone,
  )}`;
  const activeSecondaryFilters =
    (filters.turmaId ? 1 : 0) +
    (filters.professorId ? 1 : 0) +
    (filters.salaId ? 1 : 0) +
    (filters.type?.length ? 1 : 0);

  return (
    <div className={embedded ? '' : 'rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm'}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {showCurrentLabel ? (
          <div className={embedded ? 'min-w-[112px]' : ''}>
          {!embedded ? <div className="text-sm font-semibold text-slate-900">Agenda</div> : null}
          <div className={`${embedded ? 'text-sm font-medium text-slate-900' : 'mt-1 text-xs text-slate-500'}`}>
            {currentLabel}
          </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end lg:gap-2">
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl border-slate-200 px-3"
                  data-testid="agenda-secondary-filters"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  {activeSecondaryFilters > 0 ? `Filtros (${activeSecondaryFilters})` : 'Filtros'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[320px] rounded-2xl border-slate-200 p-4">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Filtros adicionais</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Use só quando precisar refinar a leitura da agenda.
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
                          onFiltersChange({ turmaId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl border-slate-200 bg-white">
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
                          onFiltersChange({ professorId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl border-slate-200 bg-white">
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

                    <div className="space-y-2">
                      <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Sala
                      </label>
                      <Select
                        value={filters.salaId ?? ALL}
                        onValueChange={(value) =>
                          onFiltersChange({ salaId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder="Sala" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>Todas as salas</SelectItem>
                          {resources.salas.map((sala) => (
                            <SelectItem key={sala.id} value={sala.id}>
                              {sala.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Tipo
                      </label>
                      <Select
                        value={filters.type?.[0] ?? ALL}
                        onValueChange={(value) =>
                          onFiltersChange({
                            type: value === ALL ? undefined : [value as CalendarEventTypeDTO],
                          })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>Todos os tipos</SelectItem>
                          {CALENDAR_EVENT_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {activeSecondaryFilters > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-xs text-slate-500 hover:text-slate-900"
                      onClick={() => {
                        onFiltersChange({
                          turmaId: undefined,
                          professorId: undefined,
                          salaId: undefined,
                          type: undefined,
                        });
                      }}
                    >
                      Limpar filtros adicionais
                    </Button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" className="h-9 rounded-xl border-slate-200" onClick={() => onNavigatePeriod('today')}>
              Hoje
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200" onClick={() => onNavigatePeriod('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200" onClick={() => onNavigatePeriod('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
