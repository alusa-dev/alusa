'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AulasLookupItemDTO, CalendarEventTypeDTO } from '@/features/lessons/dtos';
import { CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/lessons/types';
import type { AgendaFiltersState } from '@/features/lessons/agenda/hooks/use-agenda';
import { ChevronLeft, ChevronRight, Filter } from '@/components/icons/icons';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatAgendaPeriodLabel,
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
  showNavigation?: boolean;
  resourcesLoading?: boolean;
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
  showNavigation = true,
  resourcesLoading = false,
}: AgendaFiltersProps) {
  const currentLabel = formatAgendaPeriodLabel(filters.start, filters.end, filters.viewMode, timeZone);
  const activeSecondaryFilters =
    (filters.turmaId ? 1 : 0) +
    (filters.professorId ? 1 : 0) +
    (filters.salaId ? 1 : 0) +
    (filters.type?.length ? 1 : 0);

  return (
    <div className={embedded ? '' : 'rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-none'}>
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
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`h-10 rounded-lg px-4 ${activeSecondaryFilters > 0 ? 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10' : 'border-slate-200'}`}
                  data-testid="agenda-secondary-filters"
                  aria-label={activeSecondaryFilters > 0 ? `Filtros, ${activeSecondaryFilters} ativos` : 'Filtros'}
                >
                  <Filter className="mr-2 h-4 w-4" />
                  {activeSecondaryFilters > 0 ? `Filtros (${activeSecondaryFilters})` : 'Filtros'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border-slate-200 p-4">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Filtros adicionais</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {resourcesLoading ? 'Carregando turmas, professores e salas…' : 'Refine a leitura da agenda por turma, professor, sala ou tipo.'}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label htmlFor="agenda-filter-turma" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Turma
                      </label>
                      <Select
                        disabled={resourcesLoading}
                        value={filters.turmaId ?? ALL}
                        onValueChange={(value) =>
                          onFiltersChange({ turmaId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger id="agenda-filter-turma" className="h-10 rounded-lg border-slate-200 bg-white">
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
                      <label htmlFor="agenda-filter-professor" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Professor
                      </label>
                      <Select
                        disabled={resourcesLoading}
                        value={filters.professorId ?? ALL}
                        onValueChange={(value) =>
                          onFiltersChange({ professorId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger id="agenda-filter-professor" className="h-10 rounded-lg border-slate-200 bg-white">
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
                      <label htmlFor="agenda-filter-sala" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Sala
                      </label>
                      <Select
                        disabled={resourcesLoading}
                        value={filters.salaId ?? ALL}
                        onValueChange={(value) =>
                          onFiltersChange({ salaId: value === ALL ? undefined : value })
                        }
                      >
                        <SelectTrigger id="agenda-filter-sala" className="h-10 rounded-lg border-slate-200 bg-white">
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

                    <fieldset className="space-y-2">
                      <legend className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Tipo
                      </legend>
                      <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                        {CALENDAR_EVENT_TYPE_OPTIONS.map((option) => {
                          const id = `agenda-type-${option.value.toLowerCase()}`;
                          const checked = filters.type?.includes(option.value as CalendarEventTypeDTO) ?? false;

                          return (
                            <label
                              key={option.value}
                              htmlFor={id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 transition-colors hover:bg-white"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                aria-label={option.label}
                                onCheckedChange={(nextChecked) => {
                                  const nextTypes = nextChecked
                                    ? [...(filters.type ?? []), option.value]
                                    : (filters.type ?? []).filter((type) => type !== option.value);
                                  onFiltersChange({ type: nextTypes.length > 0 ? nextTypes : undefined });
                                }}
                              />
                              <span className="truncate">{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>

                </div>
              </PopoverContent>
            </Popover>

            {activeSecondaryFilters > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 rounded-lg px-3 text-sm text-slate-600 hover:text-slate-900"
                onClick={() => onFiltersChange({ turmaId: undefined, professorId: undefined, salaId: undefined, type: undefined })}
                data-testid="agenda-clear-filters"
              >
                Limpar filtros
              </Button>
            ) : null}

            {showNavigation ? (
              <>
                <Button variant="outline" className="h-10 rounded-lg border-slate-200 px-4" onClick={() => onNavigatePeriod('today')}>
                  Hoje
                </Button>
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg border-slate-200" aria-label="Período anterior" title="Período anterior" onClick={() => onNavigatePeriod('prev')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg border-slate-200" aria-label="Próximo período" title="Próximo período" onClick={() => onNavigatePeriod('next')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
