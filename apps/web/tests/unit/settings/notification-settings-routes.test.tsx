import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import NotificationSettingsPage from '@/app/(app)/admin/configuracoes/notificacoes/page';
import ConfiguracoesLayout from '@/app/(app)/admin/configuracoes/layout';
import SettingsLayout from '@/app/(app)/admin/settings/layout';
import LegacyAsaasNotificationsPage from '@/app/(app)/admin/settings/notifications/asaas/page';
import LegacyNotificationsPage from '@/app/(app)/admin/settings/notifications/page';

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn(), redirect: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/features/settings/notifications/asaas/AsaasNotificationSettings', () => ({
  AsaasNotificationSettings: () => <div>Preferências de notificações</div>,
}));
vi.mock('@/features/settings/components/SettingsCardNav', () => ({
  default: () => <nav aria-label="Navegação de Configurações">Notificações</nav>,
}));

void React;

describe('rotas de configurações de notificações', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mantém sessão, conta e papel autorizados no destino canônico', async () => {
    mocks.getServerSession.mockResolvedValue({ user: { contaId: 'conta-1', role: 'FINANCEIRO' } });

    const page = await NotificationSettingsPage();
    render(page);

    expect(screen.getByText('Preferências de notificações')).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('redireciona usuários sem conta ou papel autorizado', async () => {
    mocks.getServerSession.mockResolvedValue({ user: { contaId: 'conta-1', role: 'PROFESSOR' } });

    await NotificationSettingsPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/admin/settings');
  });

  it('redireciona os dois endereços antigos ao destino canônico', () => {
    LegacyAsaasNotificationsPage();
    LegacyNotificationsPage();

    expect(mocks.redirect).toHaveBeenNthCalledWith(1, '/admin/configuracoes/notificacoes');
    expect(mocks.redirect).toHaveBeenNthCalledWith(2, '/admin/configuracoes/notificacoes');
  });

  it('compõe a moldura e navegação compartilhadas nos dois layouts', () => {
    const { unmount } = render(ConfiguracoesLayout({ children: <p>Destino canônico</p> }));
    expect(screen.getByTestId('settings-card-layout')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação de Configurações' })).toBeInTheDocument();
    expect(screen.getByText('Destino canônico')).toBeInTheDocument();

    unmount();
    render(SettingsLayout({ children: <p>Configuração antiga</p> }));
    expect(screen.getByTestId('settings-card-layout')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação de Configurações' })).toBeInTheDocument();
    expect(screen.getByText('Configuração antiga')).toBeInTheDocument();
  });
});
