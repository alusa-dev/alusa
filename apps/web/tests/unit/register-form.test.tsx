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

  it('mantém o e-mail do convite visível e bloqueado, exibe a força da senha e alterna sua visibilidade', async () => {
    const { default: RegisterForm } = await import('@/app/(auth)/register/RegisterForm');

    render(
      <RegisterForm
        inviteData={{
          email: 'colaboradora@example.com',
          role: 'RECEPCAO',
          token: 'invite-token',
        }}
      />,
    );

    const email = screen.getByTestId('register-email') as HTMLInputElement;
    expect(email).toHaveValue('colaboradora@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(email).not.toBeDisabled();
    expect(screen.getByText(/Você recebeu um convite para acessar a Alusa com o perfil de/)).toBeInTheDocument();
    expect(screen.getByText('Recepção', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText(/Não recebeu este convite\?/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Contatar administrador' })).not.toBeInTheDocument();

    const password = screen.getByTestId('register-senha') as HTMLInputElement;
    expect(screen.queryByRole('progressbar', { name: 'Avaliação de segurança da senha' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('register-password-strength-label')).not.toBeInTheDocument();

    // Simula autofill do navegador, que altera o valor do input sem disparar onChange.
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setNativeValue?.call(password, 'StrongPass123!');
    fireEvent.focus(password);

    expect(await screen.findByText('Muito forte')).toBeInTheDocument();
    expect(screen.queryByText('Força da senha')).not.toBeInTheDocument();
    expect(screen.getByTestId('register-password-strength-label')).toHaveTextContent('Muito forte');
    const progressbar = screen.getByRole('progressbar', { name: 'Avaliação de segurança da senha' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '5');
    expect(progressbar.children).toHaveLength(1);
    expect(progressbar.firstElementChild).toHaveStyle({ width: '100%' });

    const passwordToggle = screen.getAllByRole('button', { name: 'Mostrar senha' })[0];
    expect(passwordToggle).toHaveClass('rounded-full', 'hover:bg-transparent');
    fireEvent.click(passwordToggle);
    expect(password).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(password).toHaveAttribute('type', 'password');

    const confirmPassword = screen.getByTestId('register-senha-confirmar') as HTMLInputElement;
    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar senha' })[1]);
    expect(confirmPassword).toHaveAttribute('type', 'text');
  });

  it('envia a aceitação do convite com o e-mail vinculado ao token', async () => {
    const { default: RegisterForm } = await import('@/app/(auth)/register/RegisterForm');

    render(
      <RegisterForm
        inviteData={{
          email: 'colaboradora@example.com',
          role: 'RECEPCAO',
          token: 'invite-token',
        }}
      />,
    );

    fireEvent.change(screen.getByTestId('register-nome-first'), { target: { value: 'Bia' } });
    fireEvent.change(screen.getByTestId('register-nome-last'), { target: { value: 'Alencar' } });
    fireEvent.change(screen.getByTestId('register-senha'), { target: { value: 'StrongPass123!' } });
    fireEvent.change(screen.getByTestId('register-senha-confirmar'), { target: { value: 'StrongPass123!' } });
    fireEvent.click(screen.getByTestId('register-termos-checkbox'));
    fireEvent.click(await screen.findByTestId('legal-acceptance-inner-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Aceitar e continuar/i }));
    fireEvent.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [endpoint, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body));

    expect(endpoint).toBe('/api/users/accept');
    expect(payload).toMatchObject({
      token: 'invite-token',
      email: 'colaboradora@example.com',
      password: 'StrongPass123!',
      name: 'Bia Alencar',
    });
  });

  it('mostra como toast, sem erro inline, quando o e-mail já está vinculado à escola', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'USER_ALREADY_LINKED',
        error: 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
      }),
    });
    const { default: RegisterForm } = await import('@/app/(auth)/register/RegisterForm');

    render(
      <RegisterForm inviteData={{ role: 'RESPONSAVEL', token: 'invite-token' }} />,
    );

    fireEvent.change(screen.getByTestId('register-nome-first'), { target: { value: 'Bryan' } });
    fireEvent.change(screen.getByTestId('register-nome-last'), { target: { value: 'Alencar' } });
    fireEvent.change(screen.getByTestId('register-email'), { target: { value: 'bryan@example.com' } });
    fireEvent.change(screen.getByTestId('register-guardian-cpf'), { target: { value: '529.982.247-25' } });
    fireEvent.change(screen.getByTestId('register-guardian-phone'), { target: { value: '(11) 99999-9999' } });
    fireEvent.change(screen.getByTestId('register-senha'), { target: { value: 'StrongPass123!' } });
    fireEvent.change(screen.getByTestId('register-senha-confirmar'), { target: { value: 'StrongPass123!' } });
    fireEvent.click(screen.getByTestId('register-termos-checkbox'));
    fireEvent.click(await screen.findByTestId('legal-acceptance-inner-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Aceitar e continuar/i }));
    fireEvent.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(toastCustomMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('register-error')).not.toBeInTheDocument();
    const renderToast = toastCustomMock.mock.calls[0]?.[0] as (id: string) => React.ReactElement;
    const toastElement = renderToast('toast-id');
    expect(toastElement.props).toMatchObject({
      title: 'Conta já vinculada',
      description: 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
      variant: 'warning',
    });
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
