import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sessionState = vi.hoisted(() => ({
  data: { user: { id: 'user-1', role: 'ADMIN' } },
  status: 'authenticated',
}));

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('@/lib/observability/client-operational-log', () => ({ logClientOperationalEvent: vi.fn() }));
vi.mock('../dtos/platform-billing-summary', () => ({
  platformBillingAccessDTOSchema: { parse: (value: unknown) => value },
  platformBillingSummaryDTOSchema: { parse: (value: unknown) => value },
}));
vi.mock('@/components/layout/DataTable', () => ({ default: () => null }));
vi.mock('@/components/ui/dialog', () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, title, confirmText, onConfirm, loading }: {
    open: boolean;
    title: string;
    confirmText: string;
    onConfirm: () => void;
    loading: boolean;
  }) => open ? (
    <div role="alertdialog">
      <p>{title}</p>
      <button type="button" data-testid="confirm-plan-change" disabled={loading} onClick={onConfirm}>{confirmText}</button>
    </div>
  ) : null,
}));

import { PlatformBillingFeature } from '../PlatformBillingFeature';
import { PlatformBillingProvider, usePlatformBilling } from '../PlatformBillingContext';

const generatedAt = '2030-05-01T12:00:00.000Z';

function billingSummary(contaName = 'Escola Alusa') {
  const plans = (['STARTER', 'PREMIUM', 'PRO'] as const).map((code, index) => ({
    code,
    name: code,
    amountCents: (index + 1) * 10_000,
    currency: 'brl' as const,
    interval: 'month' as const,
    trialDays: 14,
    maxActiveStudents: (index + 1) * 60,
    publicCheckoutEnabled: true as const,
    includedFeatures: [],
  }));
  const account = {
    id: 'billing-account-1',
    status: 'ACTIVE',
    accessStatus: 'ACTIVE',
    planCode: 'PRO',
    stripeCustomerId: 'customer-1',
    stripeSubscriptionId: 'subscription-1',
    currentPeriodEnd: '2030-06-01T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialWillEndNotifiedAt: null,
    gracePeriodEndsAt: null,
    restrictedAt: null,
    canceledAt: null,
    lastPaymentFailedAt: null,
    firstPaidAt: null,
    lastSuccessfulPaymentAt: null,
    paymentMethodStatus: 'PRESENT',
    paymentMethodType: 'card',
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
    paymentMethodExpMonth: 12,
    paymentMethodExpYear: 2032,
    restrictionReason: null,
    gracePeriodStartedAt: null,
    accessStateVersion: 0,
    lastProviderEventCreatedAt: null,
    lastReconciledAt: null,
    pendingPlanCode: null,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
  };
  return {
    marker: 'previous-summary',
    environment: 'TEST',
    canManage: true,
    billingInfo: { contaName, email: 'financeiro@alusa.test' },
    activeStudents: 10,
    account,
    access: {
      accountId: 'account-1',
      billingStatus: 'ACTIVE',
      accessStatus: 'ACTIVE',
      planCode: 'PRO',
      restrictionReason: null,
      trialEndsAt: null,
      gracePeriodEndsAt: null,
      currentPeriodEnd: account.currentPeriodEnd,
      hasPaymentMethod: true,
      firstPaidAt: null,
      capabilities: {},
      communication: { level: 'NONE', noticeKey: null },
      generatedAt,
    },
    paymentMethod: { status: 'present', type: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2032 },
    plans,
    invoices: [],
    health: {
      contaId: 'conta-1',
      stripeCustomerId: 'customer-1',
      stripeSubscriptionId: 'subscription-1',
      lastWebhook: null,
      webhookStats: {},
      lastReconciliation: null,
      pendingChanges: 0,
      openIssues: 0,
    },
    planChanges: [],
    issues: [],
  };
}

function BillingProbe() {
  const { summary, loading, refresh } = usePlatformBilling();
  return (
    <>
      <output data-testid="billing-probe">{summary?.billingInfo.contaName ?? 'sem resumo'}:{String(loading)}</output>
      <button type="button" data-testid="refresh-billing" onClick={() => void refresh(true)}>Atualizar faturamento</button>
    </>
  );
}

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlatformBillingFeature refresh after a plan change', () => {
  it('mantém o sucesso visível e o resumo quando o refresh após POST 2xx falha', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(billingSummary()))
      .mockResolvedValueOnce(response({ message: 'Downgrade agendado', detail: 'A mudança será aplicada na renovação.' }))
      .mockResolvedValueOnce(response(null, false))
      .mockResolvedValueOnce(response(billingSummary('Escola Atualizada')));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PlatformBillingProvider>
        <BillingProbe />
        <PlatformBillingFeature />
      </PlatformBillingProvider>,
    );

    await screen.findByText('Escola Alusa');
    fireEvent.click(screen.getAllByRole('button', { name: 'Alterar plano' })[0]);
    const planActions = await screen.findAllByRole('button', { name: 'Alterar plano' });
    fireEvent.click(planActions[1]);
    fireEvent.click(await screen.findByTestId('confirm-plan-change'));

    expect(await screen.findByText(/Seu plano Pro continua ativo até/)).toBeTruthy();
    expect(screen.getByText('Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.')).toBeTruthy();
    expect(screen.getByTestId('billing-probe').textContent).toBe('Escola Alusa:false');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText('Mudança não concluída')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId('refresh-billing'));
    await screen.findByText('Escola Atualizada');
    await waitFor(() => {
      expect(screen.queryByText(/Seu plano Pro continua ativo até/)).toBeNull();
      expect(screen.queryByText('Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.')).toBeNull();
    });
    expect(screen.getByTestId('billing-probe').textContent).toBe('Escola Atualizada:false');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
