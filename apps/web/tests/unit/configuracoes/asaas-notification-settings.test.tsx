import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AsaasNotificationSettings } from '@/features/configuracoes/notificacoes/asaas/AsaasNotificationSettings';

void React;

const {
  syncToExistingCustomersMock,
  fetchPreferencesMock,
  updatePreferenceMock,
  setSuccessMock,
  toastCustomMock,
  toastDismissMock,
} = vi.hoisted(() => ({
  syncToExistingCustomersMock: vi.fn(),
  fetchPreferencesMock: vi.fn(),
  updatePreferenceMock: vi.fn(),
  setSuccessMock: vi.fn(),
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
}));

vi.mock('@/features/configuracoes/notificacoes/asaas/hooks/useAsaasNotificationSettings', () => ({
  useAsaasNotificationSettings: () => ({
    loading: false,
    saving: false,
    error: null,
    success: null,
    preferences: [],
    updatePreference: updatePreferenceMock,
    syncToExistingCustomers: syncToExistingCustomersMock,
    fetchPreferences: fetchPreferencesMock,
    setSuccess: setSuccessMock,
  }),
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

describe('AsaasNotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncToExistingCustomersMock.mockResolvedValue(undefined);
  });

  it('exige confirmação clara antes de sobrescrever customers existentes', async () => {
    render(<AsaasNotificationSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar existentes' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Sobrescrever notificações dos customers existentes?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reaplica a configuração global atual para todos os customers já existentes/i),
    ).toBeInTheDocument();
    expect(syncToExistingCustomersMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sobrescrever todos' }));

    await waitFor(() => {
      expect(syncToExistingCustomersMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});