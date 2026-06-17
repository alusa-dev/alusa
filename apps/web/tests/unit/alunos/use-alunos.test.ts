/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAlunos } from '@/features/cadastro/alunos/hooks/use-alunos';
import { listAlunos } from '@/features/cadastro/alunos/services/alunos-service';

vi.mock('@/features/cadastro/alunos/services/alunos-service', () => ({
  listAlunos: vi.fn(),
  deleteAluno: vi.fn(),
}));

const mockedListAlunos = vi.mocked(listAlunos);

describe('useAlunos pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carrega a página solicitada via setPage sem voltar para 1', async () => {
    mockedListAlunos
      .mockResolvedValueOnce({
        items: [{ id: '1', nome: 'Aluno 1', status: 'ATIVO' }],
        total: 7,
        page: 1,
        pageSize: 6,
      })
      .mockResolvedValueOnce({
        items: [{ id: '7', nome: 'Aluno 7', status: 'ATIVO' }],
        total: 7,
        page: 2,
        pageSize: 6,
      });

    const { result } = renderHook(() =>
      useAlunos({
        contaId: 'conta-1',
        pageSize: 6,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.page).toBe(1);
    });

    await act(async () => {
      result.current.setPage(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.page).toBe(2);
      expect(result.current.items).toEqual([{ id: '7', nome: 'Aluno 7', status: 'ATIVO' }]);
    });

    expect(mockedListAlunos).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        page: 2,
        pageSize: 6,
      }),
    );
  });

  it('volta para a página 1 quando filtros mudam', async () => {
    mockedListAlunos.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 6,
    });

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) =>
        useAlunos({
          contaId: 'conta-1',
          q,
          pageSize: 6,
        }),
      { initialProps: { q: '' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedListAlunos.mockResolvedValueOnce({
      items: [{ id: '2', nome: 'Segundo', status: 'ATIVO' }],
      total: 7,
      page: 2,
      pageSize: 6,
    });

    await act(async () => {
      result.current.setPage(2);
    });

    await waitFor(() => expect(result.current.page).toBe(2));

    rerender({ q: 'maria' });

    await waitFor(() => {
      expect(mockedListAlunos).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'maria',
          page: 1,
          pageSize: 6,
        }),
      );
    });
  });
});
