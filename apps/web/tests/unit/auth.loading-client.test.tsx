import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import LoadingClient from '@/app/(auth)/loading/LoadingClient';

void React;

const replaceMock = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@/components/auth/AuthShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-shell">{children}</div>,
}));

describe('AuthLoadingClient', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renderiza spinner e redireciona para o callback interno', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('callbackUrl=%2Ffinanceiro%2Fpagamentos'));

    render(<LoadingClient />);

    expect(screen.getByText('Carregando...')).toBeInTheDocument();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/financeiro/pagamentos');
    });
  });

  it('usa dashboard como fallback para callback externo', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('callbackUrl=https://externo.com'));

    render(<LoadingClient />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard');
    });
  });
});