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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

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
  mockSaveWizardStep5.mockClear();
  mockCompleteWizard.mockClear();
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
    provisioningStatus: 'CONNECTED',
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
      'mailto:contato@alusa.app',
    );

    fireEvent.change(slider, { target: { value: '499' } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fale com um especialista' })).not.toBeInTheDocument();
  });

  it('lets a custom invitation above 500 continue to acceptance and trial while offering support', async () => {
    mockGetWizardState.mockResolvedValueOnce({ wizard: { address: 'Rua das Flores', incomeValue: 50000, step: 5 } });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === '/api/platform-billing/onboarding-condition') {
        return new Response(JSON.stringify({ data: {
          conditionType: 'CUSTOM', studentCount: 501, monthlyAmountCents: 10100, trialDays: 14,
          customBaseMonthlyAmountCents: 10000, customIncludedStudentCount: 500, customMonthlyOverageAmountCents: 100,
          currentConditionVersion: 1, acceptedCurrentVersion: false, acceptedStudentCount: null,
          acceptedPlanCode: null, acceptedMonthlyAmountCents: null,
        } }), { status: 200 });
      }
      if (String(input) === '/api/platform-billing/onboarding-condition/acceptance') {
        return new Response(JSON.stringify({ version: 1, selectedStudentCount: 501, selectedPlanCode: 'CUSTOM', selectedMonthlyAmountCents: 10100 }), { status: 200 });
      }
      if (String(input) === '/api/platform-billing/trial') {
        return new Response(JSON.stringify({ trialEndsAt: '2030-01-15T00:00:00Z' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    render(<FinanceWizard />);

    expect(await screen.findByText('Condição comercial acordada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fale com um especialista para pedir um ajuste' })).toHaveAttribute('href', 'mailto:contato@alusa.app');
    expect(screen.queryByRole('slider', { name: 'Alunos pagantes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Simulador de mensalidade' })).toHaveTextContent('R$ 101,00');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/platform-billing/trial', expect.objectContaining({ method: 'POST' })));
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

  it('recalculates the invited standard band from the adjustable estimate and sends that selection for acceptance', async () => {
    mockGetWizardState.mockResolvedValueOnce({ wizard: { address: 'Rua das Flores', incomeValue: 50000, step: 5 } });
    vi.mocked(fetch).mockImplementation(async (input, _init) => {
      const url = String(input);
      if (url === '/api/platform-billing/onboarding-condition') {
        return new Response(JSON.stringify({ data: {
          conditionType: 'STANDARD', studentCount: 20, monthlyAmountCents: null, trialDays: 14,
          currentConditionVersion: 1, acceptedCurrentVersion: false, acceptedStudentCount: null,
          acceptedPlanCode: null, acceptedMonthlyAmountCents: null,
        } }), { status: 200 });
      }
      if (url === '/api/platform-billing/onboarding-condition/acceptance') {
        return new Response(JSON.stringify({ version: 1, selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 }), { status: 200 });
      }
      if (url === '/api/platform-billing/trial') return new Response(JSON.stringify({ trialEndsAt: '2030-01-15T00:00:00Z' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    render(<FinanceWizard />);

    const slider = await screen.findByRole('slider', { name: 'Alunos pagantes' });
    expect(slider).toHaveValue('20');
    fireEvent.change(slider, { target: { value: '100' } });
    expect(screen.getByRole('region', { name: 'Simulador de mensalidade' })).toHaveTextContent('R$ 289,00');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(mockSaveWizardStep5).toHaveBeenCalledWith({ incomeValue: 50000, onboardingStudentCount: 100 }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/platform-billing/onboarding-condition/acceptance', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ accepted: true, version: 1, selectedStudentCount: 100 }),
    })));
  });

  it('requests a new acceptance when the previously accepted estimate changes', async () => {
    mockGetWizardState.mockResolvedValueOnce({ wizard: { address: 'Rua das Flores', incomeValue: 50000, step: 5 } });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform-billing/onboarding-condition') {
        return new Response(JSON.stringify({ data: {
          conditionType: 'STANDARD', studentCount: 20, monthlyAmountCents: null, trialDays: 14,
          currentConditionVersion: 4, acceptedCurrentVersion: true, acceptedStudentCount: 20,
          acceptedPlanCode: 'BAND_001_025', acceptedMonthlyAmountCents: 9900,
        } }), { status: 200 });
      }
      if (url === '/api/platform-billing/onboarding-condition/acceptance') {
        return new Response(JSON.stringify({ version: 4, selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 }), { status: 200 });
      }
      if (url === '/api/platform-billing/trial') return new Response(JSON.stringify({ trialEndsAt: '2030-01-15T00:00:00Z' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    render(<FinanceWizard />);

    const slider = await screen.findByRole('slider', { name: 'Alunos pagantes' });
    expect(slider).toHaveValue('20');
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    const checkbox = await screen.findByRole('checkbox');
    expect(screen.getAllByText('51 a 100 alunos').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s*289,00/).length).toBeGreaterThan(0);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/platform-billing/onboarding-condition/acceptance', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ accepted: true, version: 4, selectedStudentCount: 100 }),
    })));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/platform-billing/trial', expect.anything()));
  });
});
