import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventTicketsPanel } from '@/features/events/tickets/EventTicketsPanel';

const testData = vi.hoisted(() => ({ sales: [] as Array<Record<string, unknown>>, lots: [] as Array<Record<string, unknown>> }));

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const resource = queryKey[1];
    if (resource === 'detail') return { data: { ticketMode: 'SIMPLE' }, isLoading: false };
    if (resource === 'maps') return { data: [], isLoading: false };
    if (resource === 'lots') return { data: testData.lots, isLoading: false };
    if (resource === 'sales') return { data: testData.sales, isLoading: false };
    return { data: { items: [], total: 0 }, isLoading: false };
  },
}));

vi.mock('@/components/layout/DataTable', () => ({
  default: ({ data, emptyMessage }: { data: Array<Record<string, unknown>>; emptyMessage: React.ReactNode }) => (
    data.length > 0
      ? <div>{data.map((row) => <div key={String(row.id)}>{String(row.buyerName ?? row.name)}</div>)}</div>
      : <div>{emptyMessage}</div>
  ),
}));

vi.mock('@/components/ui/tabs', async () => {
  const ReactModule = await import('react');
  const TabsContext = ReactModule.createContext({ value: 'sales', onValueChange: (_value: string) => {} });
  return {
    Tabs: ({ value, onValueChange, children }: { value: string; onValueChange: (_value: string) => void; children: React.ReactNode }) =>
      ReactModule.createElement(TabsContext.Provider, { value: { value, onValueChange } }, children),
    TabsList: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
    TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = ReactModule.useContext(TabsContext);
      return ReactModule.createElement('button', { type: 'button', onClick: () => context.onValueChange(value) }, children);
    },
    TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = ReactModule.useContext(TabsContext);
      return context.value === value ? ReactModule.createElement('div', null, children) : null;
    },
  };
});

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/icons/icons', () => ({ Plus: () => null, Search: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} /> }));
vi.mock('@/features/events/tickets/LotFormDialog', () => ({ LotFormDialog: () => null }));
vi.mock('@/features/events/tickets/SaleFormDialog', () => ({ SaleFormDialog: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function sale(id: string, buyerName: string, status = 'PAID') {
  return {
    id,
    buyerName,
    status,
    lot: { id: 'lot-1', name: 'Lote Geral', ticketType: 'GENERAL' },
    sessionName: 'Sessão Árvore',
  };
}

function lot(id: string, name: string, mapName: string | null = null) {
  return { id, name, eventMap: mapName ? { name: mapName } : null };
}

describe('EventTicketsPanel search', () => {
  afterEach(() => {
    testData.sales = [];
    testData.lots = [];
  });

  it('filters sales accent-insensitively, shows a no-results state, and removes the report link', () => {
    testData.sales = [sale('1', 'José Alves'), sale('2', 'Maria Lima'), sale('3', 'Renato Souza', 'RESERVED')];
    render(<EventTicketsPanel eventId="event-1" />);

    expect(screen.queryByText('Ver desempenho')).toBeNull();
    const search = screen.getByRole('searchbox', { name: 'Buscar comprador, mapa ou lote' });
    fireEvent.change(search, { target: { value: 'jose' } });
    expect(screen.getByText('José Alves')).toBeTruthy();
    expect(screen.queryByText('Maria Lima')).toBeNull();

    fireEvent.change(search, { target: { value: 'ausente' } });
    expect(screen.getByText('Nenhuma venda encontrada.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reservados' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar comprador, mapa ou lote' }), { target: { value: 'sessao arvore' } });
    expect(screen.getByText('Renato Souza')).toBeTruthy();
    expect(screen.queryByText('José Alves')).toBeNull();
  });

  it('resets pagination when a different query returns the same number of sales', () => {
    testData.sales = [
      ...Array.from({ length: 8 }, (_, index) => sale(`a-${index + 1}`, `Alpha Buyer ${index + 1}`)),
      ...Array.from({ length: 8 }, (_, index) => sale(`b-${index + 1}`, `Beta Buyer ${index + 1}`)),
    ];
    render(<EventTicketsPanel eventId="event-1" />);

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    const search = screen.getByRole('searchbox', { name: 'Buscar comprador, mapa ou lote' });
    fireEvent.change(search, { target: { value: 'alpha' } });
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Alpha Buyer 8')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'beta' } });
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect(screen.getByText('Beta Buyer 1')).toBeTruthy();
    expect(screen.queryByText('Beta Buyer 8')).toBeNull();
  });

  it('searches lots by name or map session and hides local search for server-paginated check-ins', () => {
    testData.sales = [sale('1', 'Comprador')];
    testData.lots = [lot('1', 'Lote Matinê', 'Sessão Árvore'), lot('2', 'Lote Noite', 'Sessão Lua')];
    render(<EventTicketsPanel eventId="event-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Lotes' }));
    const lotSearch = screen.getByRole('searchbox', { name: 'Buscar lote ou sessão' });
    fireEvent.change(lotSearch, { target: { value: 'sessao arvore' } });
    expect(screen.getByText('Lote Matinê')).toBeTruthy();
    expect(screen.queryByText('Lote Noite')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Check-ins' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
