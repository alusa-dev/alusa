import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOutMock = vi.fn();

vi.mock('next-auth/react', () => ({ signOut: signOutMock }));

describe('SignOutForInviteButton', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    signOutMock.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('encerra a sessão e retorna ao convite atual', async () => {
    const { default: SignOutForInviteButton } = await import('@/app/(auth)/register/SignOutForInviteButton');
    render(<SignOutForInviteButton token="token with spaces" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sair e continuar com este convite' }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledWith({
        callbackUrl: '/auth/register?token=token%20with%20spaces',
      });
    });
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByText('Encerrando sessão…')).toBeInTheDocument();
  });
});
