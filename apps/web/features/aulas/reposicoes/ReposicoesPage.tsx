'use client';

import { useState } from 'react';
import { addDays, endOfDay, format, startOfDay, subDays } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MakeupClassItemDTO } from '@/features/aulas/dtos';
import { MakeupClassDialog } from '@/features/aulas/reposicoes/components/MakeupClassDialog';
import { MakeupClassDetailsSheet } from '@/features/aulas/reposicoes/components/MakeupClassDetailsSheet';
import { useMakeupClasses } from '@/features/aulas/reposicoes/hooks/use-makeup-classes';
import { MAKEUP_STATUS_OPTIONS } from '@/features/aulas/types';
import { Filter, Plus } from '@/components/icons/icons';

const ALL = '__ALL__';
const DEFAULT_START = startOfDay(subDays(new Date(), 30)).toISOString();
const DEFAULT_END = endOfDay(addDays(new Date(), 30)).toISOString();
const TRIGGER_CLASS = 'h-9 rounded-xl border-slate-200 bg-white';

function toDateInputValue(value?: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

function getStatusVariant(status: MakeupClassItemDTO['status']) {
  if (status === 'REALIZADA') return 'success';
  if (status === 'CANCELADA') return 'neutral';
  return 'info';
}

function MakeupRow({
  item,
  onSelect,
}: {
  item: MakeupClassItemDTO;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-testid="makeup-row"
      data-makeup-id={item.id}
      data-origin-title={item.eventoOrigem.title}
      className="grid w-full gap-3 border-b border-slate-100 px-5 py-4 text-left transition-colors hover:bg-slate-50 md:grid-cols-[1.1fr_1.1fr_1fr_0.8fr]"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Origem</div>
        <div className="mt-1 truncate text-sm font-semibold text-slate-900">{item.turmaOrigem.label}</div>
        <div className="mt-1 truncate text-xs text-slate-500">
          {item.eventoOrigem.title} • {format(new Date(item.eventoOrigem.startAt), "dd/MM/yyyy 'às' HH:mm")}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Destino</div>
        <div className="mt-1 truncate text-sm font-semibold text-slate-900">{item.turmaDestino.label}</div>
        <div className="mt-1 truncate text-xs text-slate-500">
          {item.eventoDestino.title} • {format(new Date(item.eventoDestino.startAt), "dd/MM/yyyy 'às' HH:mm")}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Aluno / Escopo</div>
        <div className="mt-1 truncate text-sm text-slate-700">{item.aluno?.label ?? 'Reposição coletiva'}</div>
        <div className="mt-1 text-xs text-slate-500">{item.scope}</div>
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-end">
        <Badge variant={getStatusVariant(item.status)}>{item.status}</Badge>
        <span className="text-xs font-medium text-slate-400">Detalhes</span>
      </div>
    </button>
  );
}

export function ReposicoesPage() {
  const { filters, setFilters, data, loading, error } = useMakeupClasses({
    startDate: DEFAULT_START,
    endDate: DEFAULT_END,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const resources = data?.data.resources ?? { turmas: [], alunos: [] };
  const items = data?.data.items ?? [];
  const summary = {
    agendadas: items.filter((item) => item.status === 'AGENDADA').length,
    realizadas: items.filter((item) => item.status === 'REALIZADA').length,
    canceladas: items.filter((item) => item.status === 'CANCELADA').length,
    coletivas: items.filter((item) => item.scope === 'COLETIVA').length,
  };

  const activeFilterCount = [
    filters.turmaId,
    filters.alunoId,
    filters.status?.length,
    filters.startDate !== DEFAULT_START ? filters.startDate : undefined,
    filters.endDate !== DEFAULT_END ? filters.endDate : undefined,
  ].filter(Boolean).length;

  function handleRefresh() {
    setFilters((current) => ({ ...current }));
  }

  return (
    <div className="space-y-4 pr-4 xl:pr-6">
      <div className="px-1">
        <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">Reposições</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre compensações sem quebrar a agenda base da turma e mantenha origem e destino vinculados.
        </p>
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold text-slate-900">Painel operacional</div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={TRIGGER_CLASS}>
                  <Filter className="mr-2 h-3.5 w-3.5" />
                  Filtros
                  {activeFilterCount > 0 && (
                    <Badge variant="info" className="ml-2 h-5 min-w-5 px-1 text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[320px] rounded-2xl border-slate-200 p-4">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Turma
                    </label>
                    <Select
                      value={filters.turmaId ?? ALL}
                      onValueChange={(value) =>
                        setFilters((current) => ({ ...current, turmaId: value === ALL ? undefined : value }))
                      }
                    >
                      <SelectTrigger className={TRIGGER_CLASS}>
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

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Aluno
                    </label>
                    <Select
                      value={filters.alunoId ?? ALL}
                      onValueChange={(value) =>
                        setFilters((current) => ({ ...current, alunoId: value === ALL ? undefined : value }))
                      }
                    >
                      <SelectTrigger className={TRIGGER_CLASS}>
                        <SelectValue placeholder="Aluno" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Todos os alunos</SelectItem>
                        {resources.alunos.map((aluno) => (
                          <SelectItem key={aluno.id} value={aluno.id}>
                            {aluno.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Status
                    </label>
                    <Select
                      value={filters.status?.[0] ?? ALL}
                      onValueChange={(value) =>
                        setFilters((current) => ({
                          ...current,
                          status: value === ALL ? undefined : [value],
                        }))
                      }
                    >
                      <SelectTrigger className={TRIGGER_CLASS}>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Todos os status</SelectItem>
                        {MAKEUP_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Início
                      </label>
                      <Input
                        type="date"
                        value={toDateInputValue(filters.startDate)}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            startDate: event.target.value
                              ? startOfDay(new Date(`${event.target.value}T00:00:00`)).toISOString()
                              : undefined,
                          }))
                        }
                        className={TRIGGER_CLASS}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Fim
                      </label>
                      <Input
                        type="date"
                        value={toDateInputValue(filters.endDate)}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            endDate: event.target.value
                              ? endOfDay(new Date(`${event.target.value}T00:00:00`)).toISOString()
                              : undefined,
                          }))
                        }
                        className={TRIGGER_CLASS}
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              size="sm"
              className="h-9 rounded-xl bg-brand-accent text-xs text-white hover:bg-brand-accent/90"
              onClick={() => setCreateOpen(true)}
              data-testid="makeup-create-open"
              disabled={loading || !data}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Nova reposição
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>
            <span className="font-semibold text-slate-900">{summary.agendadas}</span> agendadas
          </span>
          <span>
            <span className="font-semibold text-slate-900">{summary.realizadas}</span> realizadas
          </span>
          <span>
            <span className="font-semibold text-slate-900">{summary.canceladas}</span> canceladas
          </span>
          <span>
            <span className="font-semibold text-slate-900">{summary.coletivas}</span> coletivas
          </span>
        </div>
      </div>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="px-5 py-10 text-sm text-slate-500">Carregando reposições...</div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-500">Nenhuma reposição encontrada.</div>
        ) : (
          <div>
            {items.map((item) => (
              <MakeupRow key={item.id} item={item} onSelect={setSelectedId} />
            ))}
          </div>
        )}
      </Card>

      <MakeupClassDialog
        open={createOpen}
        resources={resources}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          handleRefresh();
        }}
      />

      <MakeupClassDetailsSheet
        open={Boolean(selectedId)}
        makeupClassId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onUpdated={handleRefresh}
      />
    </div>
  );
}
