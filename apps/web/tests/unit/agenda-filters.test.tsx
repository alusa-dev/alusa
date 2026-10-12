import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgendaFilters } from '@/features/lessons/agenda/components/AgendaFilters';
import { mergeAgendaFilters, type AgendaFiltersState } from '@/features/lessons/agenda/hooks/use-agenda';

describe('AgendaFilters', () => {
  it('indicates active filters and exposes one clear action that preserves the period', () => {
    const onFiltersChange = vi.fn();
    const filters: AgendaFiltersState = {
      start: '2026-08-05T04:00:00.000Z',
      end: '2026-08-06T03:59:59.999Z',
      viewMode: 'day',
      turmaId: 'turma-1',
      type: ['AULA'],
    };

    render(
      <AgendaFilters
        embedded
        showCurrentLabel={false}
        showNavigation={false}
        filters={filters}
        resources={{ turmas: [], professores: [], salas: [] }}
        onFiltersChange={onFiltersChange}
        onNavigatePeriod={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Filtros, 2 ativos' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agenda-clear-filters'));
    expect(onFiltersChange).toHaveBeenCalledWith({
      turmaId: undefined,
      professorId: undefined,
      salaId: undefined,
      type: undefined,
    });

    const nextFilters = mergeAgendaFilters(filters, onFiltersChange.mock.calls[0][0]);
    expect(nextFilters.start).toBe(filters.start);
    expect(nextFilters.end).toBe(filters.end);
    expect(nextFilters.viewMode).toBe(filters.viewMode);
    expect(screen.queryByText('Limpar filtros adicionais')).not.toBeInTheDocument();
  });
});
