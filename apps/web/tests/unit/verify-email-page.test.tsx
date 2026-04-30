import React, { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.fn();
const updateMock = vi.fn();
const useSessionMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: searchParamsGetMock,
  }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/components/auth/AuthPageContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/auth/AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('VerifyEmailPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'token') return 'valid-token-12345678901234567890';
      if (key === 'callbackUrl') return null;
      return null;
    });
    updateMock.mockResolvedValue(undefined);
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: 'ADMIN',
        },
      },
      update: updateMock,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: 'user@example.com' }),
    } as Response);
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('confirma o e-mail com sucesso sob StrictMode', async () => {
    const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');

    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(await screen.findByText('E-mail confirmado com sucesso.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/finance/wizard');
  });

  it('refaz a verificação quando a primeira tentativa é abortada pelo StrictMode', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, email: 'user@example.com' }),
      } as Response);

    const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');

    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );

    expect(await screen.findByText('E-mail confirmado com sucesso.')).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/finance/wizard');
  });

  it('mostra erro quando a requisição falha', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');

    render(<VerifyEmailPage />);

    expect(
      await screen.findByText('Não foi possível confirmar o e-mail. Tente abrir o link novamente.'),
    ).toBeInTheDocument();
  });

  it('ignora callbackUrl contaminado e redireciona para o onboarding do admin', async () => {
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'token') return 'valid-token-12345678901234567890';
      if (key === 'callbackUrl') return '/finance/wizard","idempotencyKey":"verify_email/token_1';
      return null;
    });

    const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');

    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/finance/wizard');
  });
});
