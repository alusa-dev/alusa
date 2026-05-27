import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signInMock = vi.fn();
const fetchMock = vi.fn();
const toastCustomMock = vi.fn();
const toastDismissMock = vi.fn();

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

vi.mock('@/components/auth/AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    custom: toastCustomMock,
    dismiss: toastDismissMock,
  },
  CustomToast: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <span>{title}</span>
      {description ? <span>{description}</span> : null}
    </div>
  ),
}));

vi.mock('@/lib/debug-logger', () => ({
  debugLog: vi.fn(),
  isAuthDebug: false,
}));

describe('RegisterForm', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ user: { email: 'qa@example.com', contaId: 'conta_1' } }),
    });
    signInMock.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia financeIntegrationMode externo quando o usuario seleciona conta existente do Asaas', async () => {
    const { default: RegisterForm } = await import('@/app/(auth)/register/RegisterForm');

    render(<RegisterForm enableExternalAsaasOnboarding />);

    fireEvent.change(screen.getByTestId('register-nome-first'), { target: { value: 'Elaine' } });
    fireEvent.change(screen.getByTestId('register-nome-last'), { target: { value: 'Costa' } });
    fireEvent.change(screen.getByTestId('register-email'), { target: { value: 'elaine.costa@example.com' } });
    fireEvent.click(screen.getByTestId('register-finance-integration-mode'));
    fireEvent.click(screen.getByRole('option', { name: /Já tenho uma conta no Asaas/i }));
    fireEvent.change(screen.getByTestId('register-senha'), { target: { value: 'StrongPass123!' } });
    fireEvent.change(screen.getByTestId('register-senha-confirmar'), { target: { value: 'StrongPass123!' } });
    fireEvent.click(screen.getByTestId('register-termos-checkbox'));
    fireEvent.click(await screen.findByTestId('legal-acceptance-inner-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Aceitar e continuar/i }));
    fireEvent.click(screen.getByTestId('register-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body));

    expect(payload.financeIntegrationMode).toBe('EXTERNAL_ASAAS_ACCOUNT');
  });
});
