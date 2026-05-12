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
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limpa os itens recentes pelo botão', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: 'Limpar' }));

    await waitFor(() => {
      expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument();
    });
    expect(storage.removeItem).toHaveBeenCalledWith('alusa.global-search.recent-items');
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
    expect(screen.getByText('Aluno')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/alunos/aluno-1');
    });
    expect(storage.getItem('alusa.global-search.recent-items')).toContain('Maria Silva');
  });

  it('exibe cobranca com nome no titulo, payment id abaixo e badge especifico', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'taxa',
        groups: [
          {
            key: 'cobrancas',
            label: 'Cobranças',
            total: 1,
            items: [
              {
                id: 'cob-1',
                type: 'cobranca',
                title: 'Guilherme Araújo Souza',
                description: 'pay_123',
                badgeLabel: 'Taxa de matrícula',
                href: '/cobrancas/cob-1',
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
    fireEvent.change(input, { target: { value: 'taxa' } });

    expect(await screen.findByText('Guilherme Araújo Souza')).toBeInTheDocument();
    expect(screen.getByText('pay_123')).toBeInTheDocument();
    expect(screen.getByText('Taxa de matrícula')).toBeInTheDocument();
  });
});