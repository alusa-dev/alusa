import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceWizard } from '@/features/finance/operations/components/wizard/FinanceWizard';

const { mockGetWizardState, mockSaveWizardStep5, mockCompleteWizard } = vi.hoisted(() => ({
  mockGetWizardState: vi.fn(),
  mockSaveWizardStep5: vi.fn(),
  mockCompleteWizard: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { financeIntegrationMode: 'WHITELABEL_BAAS' } }, update: vi.fn(async () => undefined) }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

vi.mock('@/components/ui/toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('@/components/core/sliding-number', () => ({
  SlidingNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

vi.mock('@/features/finance/operations/components/wizard/wizard-service', () => ({
  getWizardState: mockGetWizardState,
  saveWizardStep1: vi.fn(),
  saveWizardStep2: vi.fn(),
  saveWizardStep3: vi.fn(),
  saveWizardStep4: vi.fn(),
  saveWizardStep5: mockSaveWizardStep5,
  completeWizard: mockCompleteWizard,
  WizardApiError: class WizardApiError extends Error {},
}));

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  mockGetWizardState.mockResolvedValue({
    wizard: {
      address: 'Rua das Flores',
      incomeValue: 50000,
      step: 5,
    },
  });
  mockSaveWizardStep5.mockResolvedValue({ success: true, wizard: {}, nextStep: 6 });
  mockCompleteWizard.mockResolvedValue({
    success: true,
    wizard: { step: 6, completedAt: new Date() },
    canCreateSubaccount: true,
    missingFields: [],
    provisioningStatus: 'QUEUED',
  });
});

describe('FinanceWizard pricing simulator', () => {
  it('keeps 500 students self-service and routes 501+ to a specialist', async () => {
    render(<FinanceWizard />);

    const slider = await screen.findByRole('slider', {
      name: 'Alunos pagantes',
    });
    expect(slider).toHaveValue('165');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    const simulator = screen.getByRole('region', { name: 'Simulador de mensalidade' });
    expect(simulator).toHaveTextContent('R$ 419,00');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '500' } });
    await waitFor(() => {
      expect(simulator).toHaveTextContent('R$ 649,00');
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '501' } });
    await waitFor(() => {
      expect(simulator).toHaveTextContent('Condição personalizada');
    });
    expect(screen.getByRole('link', { name: 'Fale com um especialista' })).toHaveAttribute(
      'href',
      'mailto:contato@alusa.app?subject=Plano%20para%20escola%20com%20mais%20de%20500%20alunos',
    );

    fireEvent.change(slider, { target: { value: '499' } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fale com um especialista' })).not.toBeInTheDocument();
  });

  it('persists the declared count and starts the trial only after successful completion', async () => {
    mockGetWizardState.mockResolvedValueOnce({
      wizard: {
        address: 'Rua das Flores',
        incomeValue: 50000,
        onboardingStudentCount: 165,
        step: 6,
        completedAt: new Date(),
      },
    });
    render(<FinanceWizard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(mockSaveWizardStep5).toHaveBeenCalledWith({
      incomeValue: 50000,
      onboardingStudentCount: 165,
    }));
    await waitFor(() => expect(mockCompleteWizard).toHaveBeenCalledOnce());
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/platform-billing/trial', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'onboarding-trial:initial' }),
    })));
  });
});
