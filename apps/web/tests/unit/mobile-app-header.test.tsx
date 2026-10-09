import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useUserStore: vi.fn(),
  mobileSidebar: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a {...props}>{children}</a>,
}));
vi.mock('next-auth/react', () => ({ useSession: mocks.useSession }));
vi.mock('@/lib/stores/user-store', () => ({
  useUserStore: mocks.useUserStore,
}));
vi.mock('@/components/theme/ThemeProvider', () => ({ useTheme: () => ({ isDark: false }) }));
vi.mock('@/components/layout/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('@/components/icons/icons', () => ({ Menu: () => null }));
vi.mock('@/components/layout/SidebarLogoMark', () => ({ SidebarLogoMark: () => null }));
vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: (props: { open: boolean }) => {
    mocks.mobileSidebar(props);
    return <div data-testid="mobile-sidebar" />;
  },
}));
vi.mock('@/components/layout/MobileUserMenuDrawer', () => ({
  MobileUserMenuDrawer: () => null,
}));

import { MobileAppHeader } from '@/components/layout/MobileAppHeader';

describe('MobileAppHeader', () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue({ data: { user: { role: 'ADMIN' } } });
    mocks.useUserStore.mockReturnValue(null);
    mocks.mobileSidebar.mockClear();
  });

  it('monta o menu mobile só quando é aberto para evitar fetch duplicado no shell inicial', () => {
    render(<MobileAppHeader />);

    expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    expect(mocks.mobileSidebar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));

    expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();
    expect(mocks.mobileSidebar).toHaveBeenCalledWith(expect.objectContaining({ open: true }));
  });
});
