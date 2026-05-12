import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/dashboard',
}));

describe('HeaderSearch', () => {
  const fetchMock = vi.fn();
  const storage = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();
  const resizeObserverMock = vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('ResizeObserver', resizeObserverMock);
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
    });
    storage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra recentes ao focar sem query', async () => {
    storage.setItem(
      'alusa.global-search.recent-items',
      JSON.stringify([
        {
          id: 'aluno-1',
          type: 'aluno',
          title: 'Maria Silva',
          description: '12345678900',
          href: '/alunos/aluno-1',
          visitedAt: '2026-05-12T10:00:00.000Z',
        },
      ]),
    );

    const { HeaderSearch } = await import('@/features/global-search/components/HeaderSearch');

    render(<HeaderSearch role="ADMIN" />);

    fireEvent.focus(screen.getByLabelText('Pesquisar'));

    expect(await screen.findByText('Recentes')).toBeInTheDocument();
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca sugestões e navega ao selecionar', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'mari',
        groups: [
          {
            key: 'alunos',
            label: 'Alunos',
            total: 1,
            items: [
              {
                id: 'aluno-1',
                type: 'aluno',
                title: 'Maria Silva',
                description: '12345678900',
                href: '/alunos/aluno-1',
              },
            ],
          },
        ],
      }),
    });

    const { HeaderSearch } = await import('@/features/global-search/components/HeaderSearch');

    render(<HeaderSearch role="ADMIN" />);

    const input = screen.getByLabelText('Pesquisar');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'mari' } });

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/alunos/aluno-1');
    });
    expect(storage.getItem('alusa.global-search.recent-items')).toContain('Maria Silva');
  });
});