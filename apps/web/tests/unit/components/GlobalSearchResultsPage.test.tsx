import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('GlobalSearchResultsPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renderiza resultados agrupados da busca completa', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: 'maria',
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

    const { GlobalSearchResultsPage } = await import('@/features/global-search/components/GlobalSearchResultsPage');

    render(<GlobalSearchResultsPage initialQuery="maria" />);

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Alunos')).toBeInTheDocument();
    expect(screen.getByText('Resultados para "maria"')).toBeInTheDocument();
  });
});