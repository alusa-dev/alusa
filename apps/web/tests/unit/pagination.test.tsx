import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Pagination } from '@/components/layout/Pagination';
import { EventPaginatedDataTable } from '@/features/events/shared/EventPaginatedDataTable';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('@/components/layout/DataTable', () => ({
  default: ({ data }: { data: Array<{ label: string }> }) => (
    <div>{data.map((item) => <div key={item.label}>{item.label}</div>)}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Pagination', () => {
  it('keeps page buttons unique while navigating and rerendering', () => {
    const onChange = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<Pagination total={102} page={1} pageSize={6} onChange={onChange} />);

    for (const page of [2, 3, 4, 5, 6, 7]) {
      fireEvent.click(screen.getByRole('button', { name: String(page) }));
      view.rerender(<Pagination total={102} page={page} pageSize={6} onChange={onChange} />);
      const pageButtons = screen.getAllByRole('button').filter((button) => /^\d+$/.test(button.textContent ?? ''));
      const labels = pageButtons.map((button) => button.textContent);
      expect(new Set(labels).size).toBe(labels.length);
    }

    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|duplicate key/i);
    consoleError.mockRestore();
  });

  it('clamps invalid controlled pages after total shrinks and respects navigation limits', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination total={102} page={17} pageSize={6} onChange={onChange} />);
    rerender(<Pagination total={7} page={17} pageSize={6} onChange={onChange} />);

    expect(screen.getByText('Página 2 de 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Próxima página' }).hasAttribute('disabled')).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});

describe('EventPaginatedDataTable', () => {
  it('resets to the first page when the event data shrinks', () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({ label: `Item ${index + 1}` }));
    const { rerender } = render(<EventPaginatedDataTable data={rows} columns={[]} rowKey={(row) => row.label} />);

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Item 13')).toBeTruthy();
    expect(screen.queryByText('Item 1')).toBeNull();

    rerender(<EventPaginatedDataTable data={rows.slice(0, 7)} columns={[]} rowKey={(row) => row.label} />);
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect(screen.queryByText('Item 13')).toBeNull();
  });

  it('resets to the first page when page size changes without a total change', () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({ label: `Item ${index + 1}` }));
    const { rerender } = render(
      <EventPaginatedDataTable data={rows} columns={[]} rowKey={(row) => row.label} pageSize={6} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Item 13')).toBeTruthy();

    rerender(<EventPaginatedDataTable data={rows} columns={[]} rowKey={(row) => row.label} pageSize={7} />);
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect(screen.queryByText('Item 13')).toBeNull();
  });
});
