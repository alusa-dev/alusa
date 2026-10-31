import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

void React;

const sessionState = vi.hoisted(() => ({
  data: { user: { id: 'user-1', role: 'ADMIN' } as { id: string; role: string } | null },
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
      <button type="button" data-testid="confirm-billing-action" disabled={loading} onClick={onConfirm}>{confirmText}</button>
    </div>
  ) : null,
}));

import { navigateToSetupCheckout, PlatformBillingFeature } from '../PlatformBillingFeature';
import { CardBrandMark, formatCardBrand } from '../components/CardBrandMark';
import { PlatformBillingPersistentModal } from '../components/PlatformBillingPersistentModal';
import { PlatformBillingProvider, usePlatformBilling } from '../PlatformBillingContext';
import type { PlatformBillingSummaryDTO } from '../dtos/platform-billing-summary';

const generatedAt = '2030-05-01T12:00:00.000Z';

function billingSummary(contaName = 'Escola Alusa', cancelAtPeriodEnd = false) {
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
    cancelAtPeriodEnd,
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
    eligiblePriceBand: null,
    specialistNegotiationReady: false,
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
    paymentMethod: { status: 'present', type: 'card', brand: 'visa', last4: '4242', expMonth: 6, expYear: 2028 },
    savedTrialPaymentMethod: null as PlatformBillingSummaryDTO['savedTrialPaymentMethod'],
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

function monthlyCloseSummary(accountId: string, tenantId: string, ignoredAt: string | null = null) {
  const summary = billingSummary();
  summary.account.id = accountId;
  summary.access.accountId = accountId;
  summary.health.contaId = tenantId;
  return {
    ...summary,
    issues: [{
      id: `monthly-close-${tenantId}`,
      severity: 'WARNING' as const,
      code: 'MONTHLY_CLOSE_INCONCLUSIVE',
      title: 'Fechamento comercial mensal inconclusivo',
      message: 'Fechamento mensal inconclusivo.',
      detectedAt: generatedAt,
      ignoredAt,
      periodStart: '2030-04-01',
    }],
  };
}

describe('platform billing card brand mapping', () => {
  it.each([
    ['visa', 'Visa'],
    ['mastercard', 'Mastercard'],
    ['amex', 'American Express'],
    ['american_express', 'American Express'],
    ['cartes_bancaires', 'Cartes Bancaires'],
    ['diners', 'Diners Club'],
    ['discover', 'Discover'],
    ['discover ', 'Discover'],
    ['eftpos_au', 'eftpos'],
    ['elo', 'Elo'],
    ['hiper', 'Hipercard'],
    ['hipercard', 'Hipercard'],
    ['jcb', 'JCB'],
    ['link', 'Link'],
    ['unionpay', 'UnionPay'],
  ])('shows the supported %s mark and label', (brand, label) => {
    render(<CardBrandMark brand={brand} />);

    expect(formatCardBrand(brand)).toBe(label);
    expect(screen.getByRole('img', { name: `${label} card` })).toBeInTheDocument();
  });

  it.each([null, '', 'unknown'])('does not fabricate a mark for brand %s', (brand) => {
    const { container } = render(<CardBrandMark brand={brand} />);

    expect(container.querySelector('svg, img')).toBeNull();
    expect(formatCardBrand(brand)).toBe('Cartão');
  });
});

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

function controlCheckoutRefreshTimers() {
  const pending = new Map<number, () => Promise<void> | void>();
  const ownedIds = new Set<number>();
  let nextId = 0;
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number) => {
    if (timeout === 1500 && typeof handler === 'function') {
      nextId += 1;
      ownedIds.add(nextId);
      pending.set(nextId, handler as () => Promise<void> | void);
      return nextId;
    }
    return nativeSetTimeout(handler, timeout);
  }) as typeof window.setTimeout);
  vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
    if (ownedIds.has(id ?? -1)) {
      pending.delete(id ?? -1);
      return;
    }
    nativeClearTimeout(id);
  }) as typeof window.clearTimeout);
  return {
    pending,
    async runNext() {
      const entry = pending.entries().next().value as [number, () => Promise<void> | void] | undefined;
      if (!entry) throw new Error('No checkout status refresh was scheduled.');
      pending.delete(entry[0]);
      await act(async () => { await entry[1](); });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionState.data = { user: { id: 'user-1', role: 'ADMIN' } };
  sessionState.status = 'authenticated';
  window.sessionStorage.clear();
});

describe('monthly close notice in authenticated app shell', () => {
  const noticeTitle = 'Fechamento de abril de 2030 inconclusivo';
  const acknowledgeUrl = '/api/platform-billing/issues/monthly-close-inconclusive/acknowledge';

  function renderGlobalBillingModal() {
    return render(
      <PlatformBillingProvider>
        <>
          <BillingProbe />
          <PlatformBillingPersistentModal />
        </>
      </PlatformBillingProvider>,
    );
  }

  it('shows one toast per unacknowledged issue and persists acknowledgement only after dismissal', async () => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/dashboard');
    const fetchMock = vi.fn((url: string) => url === '/api/platform-billing/summary'
      ? Promise.resolve(response(monthlyCloseSummary('billing-account-A', 'tenant-A')))
      : Promise.resolve(response({ acknowledged: true })));
    vi.stubGlobal('fetch', fetchMock);

    renderGlobalBillingModal();

    expect(await screen.findByText(noticeTitle)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/summary')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === acknowledgeUrl)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    await waitFor(() => expect(screen.queryByText(noticeTitle)).not.toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(acknowledgeUrl, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'monthly-close-tenant-A' }),
    })));

    cleanup();
    fetchMock.mockClear();
    renderGlobalBillingModal();
    await waitFor(() => expect(screen.getByTestId('billing-probe')).toHaveTextContent('Escola Alusa:false'));
    expect(screen.queryByText(noticeTitle)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/summary')).toHaveLength(1);
    window.history.replaceState({}, '', '/');
  });

  it('acknowledges the issue and opens billing details from the CTA', async () => {
    window.sessionStorage.clear();
    const fetchMock = vi.fn((url: string) => url === '/api/platform-billing/summary'
      ? Promise.resolve(response(monthlyCloseSummary('billing-account-CTA', 'tenant-CTA')))
      : Promise.resolve(response({ acknowledged: true })));
    vi.stubGlobal('fetch', fetchMock);
    renderGlobalBillingModal();

    expect(await screen.findByText(noticeTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver faturamento' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(acknowledgeUrl, expect.anything()));
    await waitFor(() => expect(screen.queryByText(noticeTitle)).not.toBeInTheDocument());
  });

  it('does not toast an issue acknowledged server-side after a fresh session', async () => {
    window.sessionStorage.clear();
    const fetchMock = vi.fn().mockResolvedValue(response(monthlyCloseSummary('billing-account-A', 'tenant-A', generatedAt)));
    vi.stubGlobal('fetch', fetchMock);
    renderGlobalBillingModal();

    await waitFor(() => expect(screen.getByTestId('billing-probe')).toHaveTextContent('Escola Alusa:false'));
    expect(screen.queryByText(noticeTitle)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === acknowledgeUrl)).toBe(false);
  });

  it('keeps the open occurrence visible in billing with competence and unconfirmed wording', async () => {
    const summary = monthlyCloseSummary('billing-account-panel', 'tenant-panel');
    const fetchMock = vi.fn().mockResolvedValue(response(summary));
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    expect(await screen.findByText('Fechamento de abril de 2030 inconclusivo')).toBeInTheDocument();
    expect(screen.getByText(/não teve fechamento confirmado/)).toBeInTheDocument();
    expect(screen.queryByText(/fechamento mensal confirmado/i)).not.toBeInTheDocument();
  });
});

describe('PlatformBillingFeature renewal label', () => {
  it.each([
    ['active account with card', 'ACTIVE', false, /^Próxima cobrança prevista para /],
    ['cancellation scheduled at period end', 'ACTIVE', true, /^Sua assinatura será encerrada em /],
    ['trialing account', 'TRIALING', false, /^O teste termina em /],
    ['non-active account with a saved card', 'PAST_DUE', false, /^Pagamento pendente$/],
  ])('shows appropriate copy for %s', async (_label, status, cancelAtPeriodEnd, expectedCopy) => {
    const summary = billingSummary('Escola Alusa', cancelAtPeriodEnd);
    Object.assign(summary.account, {
      status,
      ...(status === 'TRIALING' ? { trialEndsAt: '2030-05-15T12:00:00.000Z' } : {}),
    });
    const fetchMock = vi.fn().mockResolvedValue(response(summary));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    expect(await screen.findByText(expectedCopy)).toBeTruthy();
    const visaMark = screen.getByRole('img', { name: 'Visa card' });
    expect(visaMark).toHaveAttribute('width', '32');
    expect(visaMark).toHaveAttribute('height', '32');
    expect(visaMark).toHaveClass('h-8', 'w-8');
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('Vence em 06/2028')).toBeInTheDocument();
  });
});

describe('PlatformBillingFeature refresh after a billing action', () => {
  it.each(['success', 'canceled'] as const)('shows setup return %s without claiming a paid subscription or default card', async (setupState) => {
    window.history.replaceState({}, '', `/account/billing-plan?setup=${setupState}&keep=1#card`);
    const trialAccount = billingSummary();
    Object.assign(trialAccount.account, { status: 'TRIALING', trialEndsAt: '2030-05-15T12:00:00.000Z' });
    Object.assign(trialAccount.access, { billingStatus: 'TRIALING' });
    trialAccount.paymentMethod = { status: 'missing', type: '', brand: '', last4: '', expMonth: 0, expYear: 0 };
    const fetchMock = vi.fn().mockResolvedValue(response(trialAccount));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature setupState={setupState} /></PlatformBillingProvider>);

    expect(await screen.findByText(setupState === 'success'
      ? /O cadastro do cartão foi concluído\. Isso não ativou assinatura nem gerou cobrança/
      : /O cadastro do cartão foi cancelado\. Nenhuma assinatura ou cobrança foi iniciada/)).toBeInTheDocument();
    if (setupState === 'success') await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/summary')).toHaveLength(2));
    expect(screen.getByText('Nenhuma forma de pagamento cadastrada')).toBeInTheDocument();
    expect(screen.queryByText('Assinatura confirmada. Seu plano já está atualizado.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Visa ••••/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#card');
  });

  it('forces a bounded success-return refresh and keeps checkout blocked until ACTIVE is read', async () => {
    const timers = controlCheckoutRefreshTimers();
    window.history.replaceState({}, '', '/billing?keep=1&checkout=success#receipt');
    let summaryCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== '/api/platform-billing/summary') return response({});
      summaryCalls += 1;
      const summary = billingSummary();
      if (summaryCalls < 4) Object.assign(summary.account, { status: 'CANCELED', accessStatus: 'CANCELED' });
      return response(summary);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="success" /></PlatformBillingProvider>);
    await screen.findByText(/Recebemos seu retorno do Stripe/);
    await waitFor(() => expect(summaryCalls).toBe(2));
    await waitFor(() => expect(timers.pending.size).toBeGreaterThan(0));
    await timers.runNext();
    await waitFor(() => expect(summaryCalls).toBe(3));
    await waitFor(() => expect(timers.pending.size).toBeGreaterThan(0));
    await timers.runNext();
    await waitFor(() => expect(summaryCalls).toBe(4));

    expect(await screen.findByText('Assinatura confirmada. Seu plano já está atualizado.')).toBeInTheDocument();
    expect(summaryCalls).toBe(4);
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#receipt');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
  });

  it('keeps checkout blocked after bounded success polling and offers a manual status refresh', async () => {
    const timers = controlCheckoutRefreshTimers();
    window.history.replaceState({}, '', '/billing?checkout=success');
    let summaryCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== '/api/platform-billing/summary') return response({});
      summaryCalls += 1;
      const summary = billingSummary();
      Object.assign(summary.account, { status: 'CANCELED', accessStatus: 'CANCELED' });
      return response(summary);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="success" /></PlatformBillingProvider>);
    await screen.findByText(/Recebemos seu retorno do Stripe/);
    await waitFor(() => expect(summaryCalls).toBe(2));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitFor(() => expect(timers.pending.size).toBeGreaterThan(0));
      await timers.runNext();
      await waitFor(() => expect(summaryCalls).toBe(attempt + 3));
    }

    expect(await screen.findByText(/Outra contratação está bloqueada para evitar uma nova cobrança/)).toBeInTheDocument();
    const checkoutButton = screen.getByRole('button', { name: 'Contratar plano' });
    expect(checkoutButton).toBeDisabled();
    expect(summaryCalls).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar status' }));
    await waitFor(() => expect(summaryCalls).toBe(6));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitFor(() => expect(timers.pending.size).toBeGreaterThan(0));
      await timers.runNext();
      await waitFor(() => expect(summaryCalls).toBe(attempt + 7));
    }
    expect(await screen.findByText(/Outra contratação está bloqueada para evitar uma nova cobrança/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contratar plano' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
  });

  it('does not call cancellation for a legacy return without a request identity and offers safe resume', async () => {
    window.history.replaceState({}, '', '/billing?checkout=cancel&studentCount=1');
    const summary = billingSummary();
    Object.assign(summary.account, { id: 'billing-account-legacy-return', status: 'NOT_STARTED', accessStatus: 'PENDING', planCode: null, stripeSubscriptionId: null, stripeCustomerId: null });
    summary.access.accountId = 'billing-account-legacy-return';
    const fetchMock = vi.fn(async (_url: string) => response(summary));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>);

    expect(await screen.findByText('Sua contratação está aguardando pagamento')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout/cancel-return')).toHaveLength(0);
    expect(window.location.search).toBe('');
    window.history.replaceState({}, '', '/');
  });

  it('reconciles a canceled Checkout return once across summary refresh rerenders', async () => {
    window.history.replaceState({}, '', '/billing?checkout=cancel&checkoutRequestKey=checkout-once-A&studentCount=1');
    const canceledReturnSummary = billingSummary();
    Object.assign(canceledReturnSummary.account, { id: 'billing-account-cancel-popup', status: 'NOT_STARTED', accessStatus: 'PENDING', planCode: null, stripeSubscriptionId: null, stripeCustomerId: null });
    canceledReturnSummary.access.accountId = 'billing-account-cancel-popup';
    const fetchMock = vi.fn(async (url: string) => url === '/api/platform-billing/checkout/cancel-return'
      ? response({ state: 'CANCELED' })
      : response(canceledReturnSummary));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><><PlatformBillingFeature checkoutState="cancel" /><PlatformBillingFeature checkoutState="cancel" /></></PlatformBillingProvider>);

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout/cancel-return')).toHaveLength(1));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/summary')).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Sua contratação está aguardando pagamento')).toBeInTheDocument();
    expect(screen.getByText('Retome o checkout para revisar e confirmar o pagamento do plano.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retomar contratação' })).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
    const resumeButton = screen.getByRole('button', { name: 'Retomar contratação' });
    fireEvent.click(resumeButton);
    fireEvent.click(resumeButton);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(1));
  });

  it('consumes only the cancel query after terminal reconciliation, preserving other URL state', async () => {
    window.history.replaceState({}, '', '/billing?keep=1&checkout=cancel&checkoutRequestKey=checkout-cleanup-A&studentCount=1#section');
    const canceledReturnSummary = billingSummary();
    Object.assign(canceledReturnSummary.account, { id: 'billing-account-query-cleanup', status: 'NOT_STARTED', accessStatus: 'PENDING', planCode: null, stripeSubscriptionId: null, stripeCustomerId: null });
    canceledReturnSummary.access.accountId = 'billing-account-query-cleanup';
    const fetchMock = vi.fn(async (url: string) => url === '/api/platform-billing/checkout/cancel-return'
      ? response({ state: 'CANCELED' })
      : response(canceledReturnSummary));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>);

    await screen.findByText('Sua contratação está aguardando pagamento');
    expect(window.location.pathname).toBe('/billing');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#section');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout/cancel-return')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    await waitFor(() => expect(screen.queryByText('Sua contratação está aguardando pagamento')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
    window.history.replaceState({}, '', '/');
  });

  it('keeps checkout blocked and the cancel query intact while reconciliation is pending', async () => {
    window.history.replaceState({}, '', '/billing?keep=1&checkout=cancel&checkoutRequestKey=checkout-pending-A#pending');
    const pendingSummary = billingSummary();
    Object.assign(pendingSummary.account, { id: 'billing-account-still-pending', status: 'NOT_STARTED', accessStatus: 'PENDING', planCode: null, stripeSubscriptionId: null, stripeCustomerId: null });
    pendingSummary.access.accountId = 'billing-account-still-pending';
    const fetchMock = vi.fn(async (url: string) => url === '/api/platform-billing/checkout/cancel-return'
      ? response({ state: 'PENDING' })
      : response(pendingSummary));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>);

    const checkoutButton = await screen.findByRole('button', { name: 'Começar teste grátis' });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout/cancel-return')).toHaveLength(1));
    expect((checkoutButton as HTMLButtonElement).disabled).toBe(true);
    expect(window.location.search).toBe('?keep=1&checkout=cancel&checkoutRequestKey=checkout-pending-A');
    expect(window.location.hash).toBe('#pending');
    expect(screen.queryByText('Sua contratação está aguardando pagamento')).not.toBeInTheDocument();
    expect(screen.queryByText(/confirmando o encerramento/)).not.toBeInTheDocument();
    fireEvent.click(checkoutButton);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout')).toHaveLength(0);
    window.history.replaceState({}, '', '/');
  });

  it('auto dismisses the resume popup after five seconds, pausing while it has focus', async () => {
    window.history.replaceState({}, '', '/billing?checkout=cancel&checkoutRequestKey=checkout-popup-A');
    const scheduledTimeouts = new Map<number, () => void>();
    let timeoutId = 0;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      if (timeout === 5000 && typeof handler === 'function') {
        timeoutId += 1;
        scheduledTimeouts.set(timeoutId, handler as () => void);
        return timeoutId;
      }
      return nativeSetTimeout(handler, timeout);
    }) as typeof window.setTimeout);
    vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
      scheduledTimeouts.delete(id ?? -1);
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout);
    const canceledReturnSummary = billingSummary();
    Object.assign(canceledReturnSummary.account, { id: 'billing-account-popup-timeout', status: 'NOT_STARTED', accessStatus: 'PENDING', planCode: null, stripeSubscriptionId: null, stripeCustomerId: null });
    canceledReturnSummary.access.accountId = 'billing-account-popup-timeout';
    const fetchMock = vi.fn(async (url: string) => url === '/api/platform-billing/checkout/cancel-return'
      ? response({ state: 'CANCELED' })
      : response(canceledReturnSummary));
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>);

    await waitFor(() => expect(screen.getByText('Sua contratação está aguardando pagamento')).toBeInTheDocument());
    expect(scheduledTimeouts.size).toBe(1);
    fireEvent.focus(screen.getByRole('status'));
    expect(scheduledTimeouts.size).toBe(0);
    expect(screen.getByText('Sua contratação está aguardando pagamento')).toBeInTheDocument();
    fireEvent.blur(screen.getByRole('status'), { relatedTarget: null });
    expect(scheduledTimeouts.size).toBe(1);
    await act(async () => { scheduledTimeouts.values().next().value?.(); });
    await waitFor(() => expect(screen.queryByText('Sua contratação está aguardando pagamento')).not.toBeInTheDocument());
  });

  it('retries a PENDING cancellation return after leaving and reentering the canceled page', async () => {
    window.history.replaceState({}, '', '/billing?checkout=cancel&checkoutRequestKey=checkout-retry-A');
    let cancelCalls = 0;
    const firstPendingResponseJson = vi.fn(async () => ({ state: 'PENDING' }));
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/platform-billing/checkout/cancel-return') {
        cancelCalls += 1;
        return cancelCalls === 1
          ? { ok: true, json: firstPendingResponseJson }
          : response({ state: 'CANCELED' });
      }
      const summary = billingSummary();
      summary.account.id = 'billing-account-retry';
      summary.access.accountId = 'billing-account-retry';
      return response(summary);
    });
    vi.stubGlobal('fetch', fetchMock);
    const tree = (state?: 'cancel') => <PlatformBillingProvider><PlatformBillingFeature checkoutState={state} /></PlatformBillingProvider>;
    render(tree('cancel'));

    await waitFor(() => expect(cancelCalls).toBe(1));
    await waitFor(() => expect(firstPendingResponseJson).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    cleanup();
    render(tree('cancel'));
    await waitFor(() => expect(cancelCalls).toBe(2));
    expect(screen.queryByText('Sua contratação está aguardando pagamento')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/summary').length).toBeGreaterThanOrEqual(2));
  });

  it('scopes concurrent canceled returns by billing account identity', async () => {
    window.history.replaceState({}, '', '/billing?checkout=cancel&checkoutRequestKey=checkout-scope-A');
    let summaryCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/platform-billing/checkout/cancel-return') return response({ state: 'PENDING' });
      summaryCalls += 1;
      const accountId = summaryCalls === 1 ? 'billing-account-a' : 'billing-account-b';
      const summary = billingSummary();
      summary.account.id = accountId;
      summary.access.accountId = accountId;
      return response(summary);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<>
      <PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>
      <PlatformBillingProvider><PlatformBillingFeature checkoutState="cancel" /></PlatformBillingProvider>
    </>);

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-billing/checkout/cancel-return')).toHaveLength(2));
  });

  it('shows a safe message when a canceled subscription checkout returns an empty JSON body', async () => {
    const canceledSubscription = billingSummary();
    Object.assign(canceledSubscription.account, {
      status: 'CANCELED',
      accessStatus: 'CANCELED',
      planCode: 'BAND_001_025',
      stripeSubscriptionId: 'subscription-canceled',
    });
    Object.assign(canceledSubscription.access, { accessStatus: 'CANCELED' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(canceledSubscription))
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Contratar plano' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Não foi possível iniciar a contratação. Tente novamente.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses checkout, not the portal, when an expired restricted trial is ready for explicit payment', async () => {
    const expiredTrial = billingSummary();
    expiredTrial.activeStudents = 501;
    Object.assign(expiredTrial.account, {
      status: 'PAUSED',
      accessStatus: 'RESTRICTED',
      planCode: 'BAND_401_500',
      trialEndsAt: '2030-04-30T12:00:00.000Z',
      stripeSubscriptionId: 'subscription-expired-trial',
    });
    Object.assign(expiredTrial.access, { restrictionReason: 'TRIAL_EXPIRED' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(expiredTrial))
      .mockResolvedValueOnce(response({ error: 'temporary', message: 'Falha simulada' }, false));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Contratar plano' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/platform-billing/checkout');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/portal')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Regularizar pagamento' })).toBeNull();
  });

  it('offers specialist contact after three specialist snapshots even when Stripe IDs are retained', async () => {
    const expiredTrial = billingSummary();
    expiredTrial.activeStudents = 501;
    expiredTrial.specialistNegotiationReady = true;
    Object.assign(expiredTrial.account, {
      status: 'PAUSED',
      accessStatus: 'RESTRICTED',
      planCode: 'BAND_401_500',
      trialEndsAt: '2030-04-30T12:00:00.000Z',
      stripeCustomerId: 'customer-retained',
      stripeSubscriptionId: 'subscription-retained',
    });
    Object.assign(expiredTrial.access, { restrictionReason: 'TRIAL_EXPIRED' });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(expiredTrial));
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    const specialistLink = await screen.findByRole('link', { name: 'Falar com um especialista' });
    expect(specialistLink.getAttribute('href')).toContain('mailto:contato@alusa.app');
    expect(screen.queryByRole('button', { name: 'Contratar plano' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regularizar pagamento' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/checkout')).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/portal')).toBe(false);
  });

  it.each([
    ['paid active account', 'ACTIVE', 'ACTIVE', 'Alterar pagamento', { portalSessionId: 'bps_test', portalUrl: 'https://portal.test' }, true],
    ['past-due account', 'PAST_DUE', 'GRACE_PERIOD', 'Regularizar pagamento', {}, false],
  ])('%s opens the billing portal without starting checkout', async (_label, status, accessStatus, actionLabel, portalResponse, opensPortalTab) => {
    const paidAccount = billingSummary();
    Object.assign(paidAccount.account, {
      status,
      accessStatus,
      firstPaidAt: '2030-04-01T12:00:00.000Z',
      lastSuccessfulPaymentAt: '2030-05-01T12:00:00.000Z',
    });
    Object.assign(paidAccount.access, { billingStatus: status, accessStatus });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(paidAccount))
      .mockResolvedValueOnce(response(portalResponse));
    vi.stubGlobal('fetch', fetchMock);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    fireEvent.click(await screen.findByRole('button', { name: actionLabel }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/platform-billing/portal');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/checkout')).toBe(false);
    if (opensPortalTab) {
      expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    } else {
      expect(openSpy).not.toHaveBeenCalled();
    }
  });

  it('não oferece coleta de pagamento durante trial sem autorização de cobrança', async () => {
    const trialAccount = billingSummary();
    Object.assign(trialAccount.account, {
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      trialEndsAt: '2030-05-15T12:00:00.000Z',
      paymentMethodStatus: 'MISSING',
      paymentMethodType: null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      paymentMethodExpMonth: null,
      paymentMethodExpYear: null,
    });
    Object.assign(trialAccount.access, { billingStatus: 'TRIALING', hasPaymentMethod: false });
    trialAccount.paymentMethod = {
      status: 'missing',
      type: 'card',
      brand: '',
      last4: '',
      expMonth: 0,
      expYear: 0,
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(response(trialAccount));
    vi.stubGlobal('fetch', fetchMock);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    await screen.findByText('Plano');
    expect(screen.queryByRole('button', { name: 'Cadastrar pagamento' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/checkout')).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('permite cadastrar cartão opcional durante trial sem abrir Checkout de assinatura', async () => {
    const trialAccount = billingSummary();
    Object.assign(trialAccount.account, {
      status: 'TRIALING',
      trialEndsAt: '2030-05-15T12:00:00.000Z',
    });
    Object.assign(trialAccount.access, { billingStatus: 'TRIALING' });
    let resolveSetupResponse!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(trialAccount))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSetupResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const popup = { opener: window, location: { href: 'about:blank' }, close: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);

    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);

    await screen.findByText('Plano');
    const setupButton = await screen.findByRole('button', { name: 'Cadastrar cartão opcional' });
    expect(setupButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(setupButton);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    resolveSetupResponse(response({ setupUrl: 'https://checkout.stripe.test/setup' }));
    await waitFor(() => expect(popup.location.href).toBe('https://checkout.stripe.test/setup'));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/portal')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/platform-billing/checkout')).toBe(false);
  });

  it('exibe cartão Setup salvo sem apresentá-lo como método padrão', async () => {
    const trial = billingSummary();
    Object.assign(trial.account, { status: 'TRIALING', paymentMethodStatus: 'MISSING' });
    trial.paymentMethod = { status: 'missing', type: 'card', brand: '', last4: '', expMonth: 0, expYear: 0 };
    trial.savedTrialPaymentMethod = {
      status: 'saved_non_default', type: 'card', brand: 'visa', last4: '4242', expMonth: 6, expYear: 2028,
    };
    Object.assign(trial.access, { hasPaymentMethod: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(trial)));
    render(<PlatformBillingProvider><PlatformBillingFeature /></PlatformBillingProvider>);
    await screen.findByText('Cartão salvo para contratação');
    expect(screen.getByText(/Não é o método padrão de cobrança/)).toBeInTheDocument();
    expect(screen.getByText('Nenhuma forma de pagamento cadastrada')).toBeInTheDocument();
    expect(trial.access.hasPaymentMethod).toBe(false);
  });

  it('uses same-tab navigation when a blocked popup returns null', () => {
    const navigate = vi.fn();
    const result = navigateToSetupCheckout('https://checkout.stripe.test/setup', null, navigate);
    expect(result).toBe('same-tab');
    expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.test/setup');
  });

  it('oculta a troca manual de faixa e atualiza o resumo depois de cancelar a assinatura', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(billingSummary()))
      .mockResolvedValueOnce(response({ message: 'Cancelamento agendado' }))
      .mockResolvedValueOnce(response(null, false))
      .mockResolvedValueOnce(response(billingSummary('Escola Atualizada', true)));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PlatformBillingProvider>
        <BillingProbe />
        <PlatformBillingFeature />
      </PlatformBillingProvider>,
    );

    await screen.findByText('Escola Alusa');
    expect(screen.queryByRole('button', { name: 'Alterar plano' })).toBeNull();
    expect(screen.queryByText('Escolha seu plano')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    fireEvent.click(await screen.findByTestId('confirm-billing-action'));

    expect(await screen.findByText('Assinatura cancelada')).toBeTruthy();
    expect(screen.getByText('Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.')).toBeTruthy();
    expect(screen.getByTestId('billing-probe').textContent).toBe('Escola Alusa:false');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId('refresh-billing'));
    await screen.findByText('Escola Atualizada');
    await waitFor(() => {
      expect(screen.queryByText('Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Reverter cancelamento' })).toBeTruthy();
    expect(screen.getByTestId('billing-probe').textContent).toBe('Escola Atualizada:false');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
