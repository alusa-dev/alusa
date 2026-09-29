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
    usePathnameMock.mockReturnValue('/account/delete');

    const { default: AccountSettingsNav } = await import('@/features/settings/components/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.getByRole('link', { name: 'Desativar conta' })).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    const labels = links.map((l) => l.textContent);
    expect(labels).toEqual([
      'Perfil',
      'Segurança',
      'Situação cadastral',
      'Plano e faturamento',
      'Desativar conta',
    ]);

    expect(screen.getByRole('link', { name: 'Desativar conta' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('não mostra "Desativar conta" para não ADMIN', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'FINANCEIRO' } } });
    usePathnameMock.mockReturnValue('/account/security');

    const { default: AccountSettingsNav } = await import('@/features/settings/components/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.queryByRole('link', { name: 'Desativar conta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Notificações' })).not.toBeInTheDocument();
  });

  it('oculta "Situação cadastral" quando a conta usa Asaas externo', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: 'ADMIN',
          financeStatus: 'FINANCE_APPROVED',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        },
      },
    });
    usePathnameMock.mockReturnValue('/account/profile');

    const { default: AccountSettingsNav } = await import('@/features/settings/components/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.queryByRole('link', { name: 'Situação cadastral' })).not.toBeInTheDocument();
  });

  it('mostra "Situação cadastral" para ADMIN em whitelabel com fluxo financeiro iniciado', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: 'ADMIN',
          financeStatus: 'FINANCE_APPROVED',
          financeIntegrationMode: 'WHITELABEL_BAAS',
        },
      },
    });
    usePathnameMock.mockReturnValue('/account/verification');

    const { default: AccountSettingsNav } = await import('@/features/settings/components/AccountSettingsNav');

    render(<AccountSettingsNav />);

    expect(screen.getByRole('link', { name: 'Situação cadastral' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Situação cadastral' })).toHaveAttribute('aria-current', 'page');
  });
});
