// Necessário para transformar JSX em ambiente de teste (config sem automatic runtime completo)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react';
void React;

import { cleanup, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const useSessionMock = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

describe('AccountSettingsNav', () => {
  beforeEach(() => {
    cleanup();
    useSessionMock.mockReset();
    usePathnameMock.mockReset();
    vi.resetModules();
  });

  it('mostra "Desativar conta" para ADMIN e mantém ordem após Segurança', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'ADMIN' } } });
    usePathnameMock.mockReturnValue('/conta/excluir-conta');

    const { default: AccountSettingsNav } = await import('@/components/settings/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.getByRole('link', { name: 'Desativar conta' })).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    const labels = links.map((l) => l.textContent);
    expect(labels).toEqual([
      'Perfil',
      'Segurança',
      'Desativar conta',
    ]);

    expect(screen.getByRole('link', { name: 'Desativar conta' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('não mostra "Desativar conta" para não ADMIN', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'FINANCEIRO' } } });
    usePathnameMock.mockReturnValue('/conta/seguranca');

    const { default: AccountSettingsNav } = await import('@/components/settings/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.queryByRole('link', { name: 'Desativar conta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Notificações' })).not.toBeInTheDocument();
  });
});
