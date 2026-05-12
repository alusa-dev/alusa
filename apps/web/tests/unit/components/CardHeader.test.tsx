// Necessário para transformar JSX em ambiente de teste (config sem automatic runtime completo)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react';
void React;
import { render, screen } from '@testing-library/react';
import CardHeader from '@/components/layout/CardHeader';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock next-auth useSession
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Maria Silva', email: 'maria@example.com' } } }),
}));

vi.mock('@/hooks/use-portal-notifications', () => ({
  usePortalNotifications: () => ({
    notifications: {
      cobrancasAtrasadas: 0,
      cobrancasPendentes: 0,
      proximosEventos: 0,
    },
    totalNotifications: 0,
    loading: false,
  }),
}));

vi.mock('@/features/notificacoes/hooks/use-notifications-feed', () => ({
  useNotificationsFeed: () => ({
    items: [],
    unreadCount: 0,
    loading: false,
    reload: vi.fn(),
    updateNotification: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}));

// Mock UserMenu to simplify assertions
vi.mock('@/components/layout/UserMenu', () => ({
  __esModule: true,
  default: ({ name, email, initials }: { name: string; email: string; initials: string }) => (
    <div data-testid="user-menu" data-name={name} data-email={email} data-initials={initials}>
      {initials}
    </div>
  ),
}));

vi.mock('@/features/global-search/components/HeaderSearch', () => ({
  HeaderSearch: () => <div data-testid="header-search">search</div>,
}));

describe('CardHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza campo de busca com placeholder', () => {
    render(<CardHeader />);
    const input = screen.getByTestId('header-search');
    expect(input).toBeInTheDocument();
  });

  it('renderiza botão de notificações acessível', () => {
    render(<CardHeader />);
    const [button] = screen.getAllByRole('button', { name: /notificações/i });
    expect(button).toBeInTheDocument();
  });

  it('passa corretamente dados do usuário para UserMenu', () => {
    render(<CardHeader />);
    const [userMenu] = screen.getAllByTestId('user-menu');
    expect(userMenu).toHaveAttribute('data-name', 'Maria Silva');
    expect(userMenu).toHaveAttribute('data-email', 'maria@example.com');
    expect(userMenu).toHaveAttribute('data-initials', 'MS');
  });
});
