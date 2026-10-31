'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogDescription,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InfoCallout } from '@/components/ui/info-callout';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { cn } from '@/lib/cn';
import { SlidingNumber } from '@/components/core/sliding-number';
import { getSchoolPriceBandRank, isSchoolPriceBandCode, resolveSchoolCommercialTarget, SCHOOL_PRICE_BANDS } from '@alusa/platform-billing/commercial-model';
import { Download, ExternalLink } from '@/components/icons/icons';
import {
  type PlatformBillingSummaryDTO,
} from './dtos/platform-billing-summary';
import { usePlatformBilling } from './PlatformBillingContext';
import { CheckoutResumePopup } from './components/CheckoutResumePopup';
import { CardBrandMark, formatCardBrand } from './components/CardBrandMark';

void React;

type PlanCode = 'BAND_001_025' | 'BAND_026_050' | 'BAND_051_100' | 'BAND_101_150' | 'BAND_151_200' | 'BAND_201_300' | 'BAND_301_400' | 'BAND_401_500' | 'STARTER' | 'PREMIUM' | 'PRO' | 'CUSTOM';
type BillingStatus =
  | 'NOT_STARTED'
  | 'CHECKOUT_PENDING'
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED'
  | 'UNKNOWN';

type BillingAccount = {
  id: string;
  status: BillingStatus;
  accessStatus: 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED';
  planCode: PlanCode | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  trialWillEndNotifiedAt: string | null;
  gracePeriodEndsAt: string | null;
  restrictedAt: string | null;
  canceledAt: string | null;
  lastPaymentFailedAt: string | null;
  lastReconciledAt: string | null;
  pendingPlanCode: PlanCode | null;
  pendingChangeType: 'UPGRADE' | 'DOWNGRADE' | 'CANCEL_AT_PERIOD_END' | 'UNDO_CANCEL' | 'REACTIVATE' | 'PAYMENT_RECOVERY' | null;
  pendingChangeEffectiveAt: string | null;
};

type BillingInvoice = {
  id: string;
  stripeInvoiceId: string;
  planCode: PlanCode | null;
  number: string | null;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE' | 'UNKNOWN';
  amountPaid: number;
  amountDue: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  failedAt: string | null;
  attempted: boolean;
  attemptCount: number;
  nextPaymentAttempt: string | null;
  lastPaymentErrorCode: string | null;
  lastPaymentErrorMessage: string | null;
};

type PaymentMethodSummary =
  | {
      status: 'present';
      type: 'card';
      brand: string | null;
      last4: string;
      expMonth: number | null;
      expYear: number | null;
    }
  | { status: 'missing' }
  | { status: 'unknown' };

type BillingSummary = PlatformBillingSummaryDTO;

type CheckoutState = 'success' | 'cancel' | null;
type SetupState = 'success' | 'canceled' | null;

type NoticeDialogState = {
  title: string;
  description: string;
  tone?: 'default' | 'destructive';
  actionLabel?: string;
  action?: 'portal';
} | null;

const checkoutCancelReturnTerminalResults = new Map<string, 'CANCELED' | 'ALREADY_CANCELED' | 'STALE'>();
const checkoutCancelReturnInFlight = new Map<string, Promise<{ state: string; ok: boolean; refreshed?: boolean }>>();
const checkoutCancelNoticeShown = new Set<string>();

function createPlatformBillingRequestKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  throw new Error('Este navegador não consegue criar uma chave segura para a operação.');
}

export function PlatformBillingFeature({ checkoutState, setupState }: { checkoutState?: CheckoutState; setupState?: SetupState }) {
  const { summary, loading, refresh, refreshFailed, userId } = usePlatformBilling();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trialCardConsent, setTrialCardConsent] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialogState>(null);
  const [billingSuccessNotice, setBillingSuccessNotice] = useState<string | null>(null);
  const [setupNotice, setSetupNotice] = useState<string | null>(null);
  const [checkoutCancelPending, setCheckoutCancelPending] = useState(checkoutState === 'cancel');
  const [checkoutSuccessState, setCheckoutSuccessState] = useState<'checking' | 'unconfirmed' | 'confirmed' | null>(
    checkoutState === 'success' ? 'checking' : null,
  );
  const [checkoutSuccessRefreshPending, setCheckoutSuccessRefreshPending] = useState(false);
  const [checkoutSuccessRefreshAttempts, setCheckoutSuccessRefreshAttempts] = useState(0);
  const [showCheckoutResume, setShowCheckoutResume] = useState(false);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [pricingStudentCount, setPricingStudentCount] = useState(165);
  const [resumeStudentCount, setResumeStudentCount] = useState<number | null>(null);
  const [pendingCancellationAction, setPendingCancellationAction] = useState<'cancel_at_period_end' | 'undo_cancel' | null>(null);
  const actionIdempotencyKeysRef = useRef<Record<string, string>>({});
  const lastSummaryRef = useRef(summary);
  const checkoutCancelHandledKeyRef = useRef<string | null>(null);
  const setupReturnHandledRef = useRef<SetupState | null>(null);
  const billingAccountId = summary?.account?.id ?? null;

  useEffect(() => {
    if (summary && summary !== lastSummaryRef.current && billingSuccessNotice) {
      setBillingSuccessNotice(null);
    }
    lastSummaryRef.current = summary;
  }, [billingSuccessNotice, summary]);

  useEffect(() => {
    setCheckoutSuccessRefreshAttempts(0);
    if (checkoutState === 'success') setCheckoutSuccessState('checking');
  }, [checkoutState, userId]);

  useEffect(() => {
    if (!setupState || !userId || setupReturnHandledRef.current === setupState) return;
    setupReturnHandledRef.current = setupState;
    consumeSetupQuery();
    if (setupState === 'success') {
      setSetupNotice('O cadastro do cartão foi concluído. Isso não ativou assinatura nem gerou cobrança; você continuará no período de teste.');
      void refresh(true);
    } else {
      setSetupNotice('O cadastro do cartão foi cancelado. Nenhuma assinatura ou cobrança foi iniciada.');
    }
  }, [refresh, setupState, userId]);

  function getActionIdempotencyKey(scope: string): string {
    const existing = actionIdempotencyKeysRef.current[scope];
    if (existing) return existing;
    const key = createPlatformBillingRequestKey(`platform-billing:${scope}`);
    actionIdempotencyKeysRef.current[scope] = key;
    return key;
  }

  function clearActionIdempotencyKey(scope: string): void {
    delete actionIdempotencyKeysRef.current[scope];
  }

  const checkoutSuccessBlocksCheckout = checkoutSuccessState === 'checking' || checkoutSuccessState === 'unconfirmed';

  useEffect(() => {
    if (checkoutState !== 'success' || !userId) return;
    if (summary?.account?.status === 'ACTIVE') {
      setCheckoutSuccessState('confirmed');
      setCheckoutSuccessRefreshPending(false);
      setBillingSuccessNotice('Assinatura confirmada. Seu plano já está atualizado.');
      consumeCheckoutSuccessQuery();
      return;
    }
    if (!summary) return;
    if (checkoutSuccessState !== 'checking' || checkoutSuccessRefreshPending) return;
    if (checkoutSuccessRefreshAttempts >= 4) {
      setCheckoutSuccessState('unconfirmed');
      consumeCheckoutSuccessQuery();
      return;
    }
    const delay = checkoutSuccessRefreshAttempts === 0 ? 0 : 1500;
    const timeout = window.setTimeout(async () => {
      setCheckoutSuccessRefreshAttempts((attempts) => attempts + 1);
      setCheckoutSuccessRefreshPending(true);
      await refresh(true);
      setCheckoutSuccessRefreshPending(false);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [checkoutState, checkoutSuccessRefreshAttempts, checkoutSuccessRefreshPending, checkoutSuccessState, refresh, summary, userId]);

  useEffect(() => {
    if (checkoutState === 'cancel') {
      const returnedStudentCount = readCheckoutStudentCount();
      const returnedCheckoutRequestKey = readCheckoutRequestKey();
      if (returnedStudentCount !== null) setResumeStudentCount(returnedStudentCount);
      if (!billingAccountId || !userId) {
        setCheckoutCancelPending(true);
        return;
      }
      const key = `${window.location.pathname}:${userId}:${billingAccountId}:${returnedCheckoutRequestKey ?? 'missing'}:${returnedStudentCount ?? 'unknown'}`;
      if (checkoutCancelHandledKeyRef.current === key) return;
      checkoutCancelHandledKeyRef.current = key;
      if (!returnedCheckoutRequestKey) {
        setCheckoutCancelPending(false);
        setShowCheckoutResume(true);
        consumeCheckoutCancelQuery();
        return;
      }
      const terminalResult = checkoutCancelReturnTerminalResults.get(key);
      if (terminalResult) {
        setCheckoutCancelPending(false);
        clearActionIdempotencyKey(returnedStudentCount === null ? 'checkout' : `checkout:${returnedStudentCount}`);
        consumeCheckoutCancelQuery();
        if (!checkoutCancelNoticeShown.has(key)) {
          checkoutCancelNoticeShown.add(key);
          setShowCheckoutResume(true);
        }
        return;
      }
      const existingRequest = checkoutCancelReturnInFlight.get(key);
      if (existingRequest) {
        setCheckoutCancelPending(true);
        void existingRequest.then(async (result) => {
          if (!result.ok || !result.refreshed || !isTerminalCheckoutCancelState(result.state)) return;
          checkoutCancelReturnTerminalResults.set(key, result.state);
          setCheckoutCancelPending(false);
          clearActionIdempotencyKey(returnedStudentCount === null ? 'checkout' : `checkout:${returnedStudentCount}`);
          consumeCheckoutCancelQuery();
          if (!checkoutCancelNoticeShown.has(key)) {
            checkoutCancelNoticeShown.add(key);
            setShowCheckoutResume(true);
          }
        });
        return;
      }
      setError(null);
      setCheckoutCancelPending(true);
      const promise: Promise<{ state: string; ok: boolean; refreshed?: boolean }> = fetch('/api/platform-billing/checkout/cancel-return', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: returnedCheckoutRequestKey }),
      })
        .then(async (response) => {
          const result = {
            ok: response.ok,
            state: (await response.json().catch(() => null) as { state?: string } | null)?.state ?? 'PENDING',
          };
          if (result.ok && isTerminalCheckoutCancelState(result.state)) {
            return { ...result, refreshed: await refresh(true) };
          }
          return result;
        })
        .catch(() => ({ ok: false, state: 'PENDING' }));
      checkoutCancelReturnInFlight.set(key, promise);
      void promise.then(async (result) => {
        if (checkoutCancelReturnInFlight.get(key) === promise) checkoutCancelReturnInFlight.delete(key);
        const terminalState = isTerminalCheckoutCancelState(result.state) ? result.state : null;
        if (result.ok && result.refreshed && isTerminalCheckoutCancelState(result.state)) {
          if (terminalState) checkoutCancelReturnTerminalResults.set(key, terminalState);
          setCheckoutCancelPending(false);
          clearActionIdempotencyKey(returnedStudentCount === null ? 'checkout' : `checkout:${returnedStudentCount}`);
          consumeCheckoutCancelQuery();
          if (!checkoutCancelNoticeShown.has(key)) {
            checkoutCancelNoticeShown.add(key);
            setShowCheckoutResume(true);
          }
        }
        else setCheckoutCancelPending(true);
      });
    } else {
      checkoutCancelHandledKeyRef.current = null;
      setCheckoutCancelPending(false);
      setResumeStudentCount(null);
    }
  }, [billingAccountId, checkoutState, refresh, userId]);

  const currentPlan = useMemo(() => {
    if (!summary?.account?.planCode) return null;
    return summary.plans.find((plan) => plan.code === summary.account?.planCode) ?? null;
  }, [summary]);

  const currentPlanMax = currentPlan?.maxActiveStudents ?? null;
  const currentPlanMin = currentPlan?.minActiveStudents ?? 1;
  const activeStudentPercent = currentPlanMax
    ? Math.max(0, Math.min(100, Math.round(((summary?.activeStudents ?? 0) - currentPlanMin + 1) / (currentPlanMax - currentPlanMin + 1) * 100)))
    : 0;
  const pendingChangeRaw = summary?.planChanges.find((change) =>
    change.status === 'PENDING_PAYMENT' || change.status === 'PENDING_EFFECTIVE_DATE'
  ) ?? null;
  const pendingChange =
    pendingChangeRaw?.type === 'CANCEL_AT_PERIOD_END' && summary?.account?.cancelAtPeriodEnd === false
      ? null
      : pendingChangeRaw;
  const isCancellationPendingChange = pendingChange?.type === 'CANCEL_AT_PERIOD_END';
  const planUsageLabel = `${summary?.activeStudents ?? 0} alunos com mensalidade prevista${currentPlan ? ` · faixa ${currentPlan.name}` : ''}`;
  const paymentMethod = summary?.paymentMethod ?? { status: 'missing' as const };
  const renewalLabel = getRenewalLabel(summary?.account ?? null, paymentMethod);
  const currentAccessStatus = summary?.account?.accessStatus ?? 'PENDING';
  const hasActiveSubscription = Boolean(summary?.account?.stripeSubscriptionId && summary.account.planCode);
  const isCanceledSubscription = summary?.account?.status === 'CANCELED' || summary?.account?.accessStatus === 'CANCELED';
  const hasManageableSubscription = hasActiveSubscription && !isCanceledSubscription;
  const hasScheduledCancellation = Boolean(summary?.account?.cancelAtPeriodEnd && !isCanceledSubscription);
  const isTrialing = summary?.account?.status === 'TRIALING';
  const canStartTrial = !hasActiveSubscription && !summary?.account?.trialEndsAt;
  const trialExpired = summary?.access.restrictionReason === 'TRIAL_EXPIRED';
  const confirmedPriceBand = isSchoolPriceBandCode(summary?.account?.planCode)
    ? SCHOOL_PRICE_BANDS.find((band) => band.code === summary.account?.planCode) ?? null
    : null;
  const commercialTarget = summary?.specialistNegotiationReady
    ? { kind: 'SPECIALIST' as const, band: null }
    : confirmedPriceBand
      ? { kind: 'SELF_SERVICE' as const, band: confirmedPriceBand }
      : resolveSchoolCommercialTarget(summary?.activeStudents ?? 0);
  const requiresPaymentAttention = Boolean(
    currentAccessStatus === 'GRACE_PERIOD' ||
    currentAccessStatus === 'RESTRICTED' ||
    summary?.account?.status === 'PAST_DUE' ||
    summary?.account?.status === 'UNPAID' ||
    summary?.account?.status === 'INCOMPLETE',
  );
  const paymentTitle = getPaymentMethodTitle(paymentMethod);
  const paymentDescription = getPaymentMethodDescription(paymentMethod);
  const paymentActionLabel = isTrialing
    ? 'Cadastrar cartão opcional'
    : paymentMethod.status === 'present' ? 'Alterar pagamento' : 'Cadastrar pagamento';
  const cancellationNotice = getCancellationNotice(summary?.account ?? null);
  const trialEndingNotice = getTrialEndingNotice(summary?.account ?? null, currentPlan);
  const monthlyCloseIssues = summary?.issues.filter((issue) => issue.code === 'MONTHLY_CLOSE_INCONCLUSIVE') ?? [];
  const otherBillingIssues = summary?.issues.filter((issue) => issue.code !== 'MONTHLY_CLOSE_INCONCLUSIVE') ?? [];
  const canStartSelfServiceFlow = (!hasManageableSubscription || trialExpired) && commercialTarget?.kind === 'SELF_SERVICE';

  async function startCheckout(studentCount?: number, expiredSessionRetry = 0) {
    if (checkoutSuccessBlocksCheckout) return;
    setActionLoading('checkout');
    setError(null);
    try {
      const idempotencyScope = studentCount === undefined ? 'checkout' : `checkout:${studentCount}`;
      const idempotencyKey = getActionIdempotencyKey(idempotencyScope);
      const response = await fetch('/api/platform-billing/checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ idempotencyKey, ...(studentCount === undefined ? {} : { studentCount }) }),
      });
      const payload = await response.json().catch(() => null) as {
        checkoutUrl?: string;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.checkoutUrl) {
        if (payload?.error === 'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED') {
          clearActionIdempotencyKey(idempotencyScope);
          if (expiredSessionRetry === 0) return await startCheckout(studentCount, 1);
        }
        const message = payload?.message ?? 'Não foi possível iniciar a contratação. Tente novamente.';
        throw new Error(message);
      }
      window.location.assign(payload.checkoutUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível abrir o pagamento.';
      setError(message);
      setNoticeDialog({
        title: 'Pagamento não iniciado',
        description: message,
        tone: 'destructive',
      });
      setActionLoading(null);
    }
  }

  async function startTrial() {
    setActionLoading('trial');
    setError(null);
    try {
      const idempotencyKey = getActionIdempotencyKey('trial');
      const response = await fetch('/api/platform-billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ idempotencyKey }),
      });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'Não foi possível iniciar o teste.');
      clearActionIdempotencyKey('trial');
      await refresh(true);
      setBillingSuccessNotice('Seu período de teste começou. Nenhum cartão foi solicitado e não haverá cobrança automática ao final.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível iniciar o teste.';
      setError(message);
      setNoticeDialog({ title: 'Teste não iniciado', description: message, tone: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  }

  async function openPortal(options?: { newTab?: boolean }) {
    setActionLoading('portal');
    setError(null);
    const checkoutWindow = options?.newTab ? window.open('about:blank', '_blank') : null;
    if (checkoutWindow) checkoutWindow.opener = null;
    try {
      const portalScope = 'portal';
      const idempotencyKey = getActionIdempotencyKey(portalScope);
      const response = await fetch('/api/platform-billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(isTrialing ? { savePaymentMethodConsent: trialCardConsent } : {}),
      });
      const payload = await response.json().catch(() => null) as { portalUrl?: string; setupUrl?: string; error?: string } | null;
      const destinationUrl = payload?.setupUrl ?? payload?.portalUrl;
      if (!response.ok || !destinationUrl) {
        throw new Error(payload?.error === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND'
          ? 'Nenhuma assinatura encontrada para esta conta.'
          : 'Não foi possível abrir a área de pagamento.');
      }
      navigateToSetupCheckout(destinationUrl, checkoutWindow);
      if (checkoutWindow) {
        clearActionIdempotencyKey(portalScope);
        setActionLoading(null);
        return;
      }
    } catch (err) {
      checkoutWindow?.close();
      const message = err instanceof Error ? err.message : 'Não foi possível abrir a área de pagamento.';
      setError(message);
      setNoticeDialog({
        title: 'Área de pagamento indisponível',
        description: message,
        tone: 'destructive',
      });
      setActionLoading(null);
    }
  }

  async function requestCancellation(action: 'cancel_at_period_end' | 'undo_cancel') {
    setActionLoading(action);
    setError(null);
    try {
      const scope = `cancellation:${action}`;
      const idempotencyKey = getActionIdempotencyKey(scope);
      const response = await fetch('/api/platform-billing/cancel', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ action, idempotencyKey }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Falha ao atualizar cancelamento.');
      setPendingCancellationAction(null);
      setNoticeDialog({
        title: action === 'undo_cancel' ? 'Cancelamento revertido' : 'Assinatura cancelada',
        description: action === 'undo_cancel'
          ? 'A assinatura continuará ativa.'
          : 'A conta mantém acesso até o fim do período atual.',
      });
      await refresh(true);
      clearActionIdempotencyKey(scope);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao atualizar cancelamento.';
      setError(message);
      setNoticeDialog({
        title: 'Cancelamento não concluído',
        description: message,
        tone: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  }

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!summary) {
    return (
      <InfoCallout variant="warning" title="Não foi possível carregar faturamento" showIcon>
        {error ?? 'Tente novamente em instantes.'}
      </InfoCallout>
    );
  }

  return (
    <div className="space-y-7 rounded-lg bg-white p-6 alusa-dark:bg-transparent md:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[420px]">
          <h2 className="text-2xl font-medium text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]">
            Plano e faturamento
          </h2>
          <p className="mt-2 text-sm leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            Gerencie sua assinatura da Alusa, acompanhe seu plano e controle o faturamento da sua conta.
          </p>
        </div>
      </header>

      {error ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Ação não concluída. Tente novamente ou atualize o pagamento quando aplicável.
        </InfoCallout>
      ) : null}

      {refreshFailed ? (
        <InfoCallout variant="info" size="sm" showIcon>
          Não foi possível atualizar agora. Os dados exibidos podem estar desatualizados.
        </InfoCallout>
      ) : null}

      {otherBillingIssues.map((issue) => (
        <InfoCallout
          key={issue.id}
          variant={issue.severity === 'CRITICAL' ? 'warning' : 'info'}
          size="sm"
          title={issue.title}
          showIcon
        >
          {issue.message}
        </InfoCallout>
      ))}

      {monthlyCloseIssues.map((issue) => (
        <InfoCallout key={issue.id} variant="info" size="sm" title={`Fechamento de ${formatCompetence(issue.periodStart)} inconclusivo`} showIcon>
          A competência {formatCompetence(issue.periodStart)} não teve fechamento confirmado. A faixa vigente foi mantida e nenhuma alteração automática foi aplicada.
        </InfoCallout>
      ))}

      {checkoutSuccessState === 'checking' ? (
        <InfoCallout variant="info" size="sm" showIcon>
          Recebemos seu retorno do Stripe e estamos confirmando a assinatura. Aguarde alguns instantes antes de iniciar outra contratação.
        </InfoCallout>
      ) : checkoutSuccessState === 'unconfirmed' ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Ainda não recebemos a confirmação da assinatura. Outra contratação está bloqueada para evitar uma nova cobrança.
          <button
            type="button"
            className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-60"
            disabled={checkoutSuccessRefreshPending}
            onClick={() => {
              setCheckoutSuccessRefreshAttempts(0);
              setCheckoutSuccessState('checking');
            }}
          >
            {checkoutSuccessRefreshPending ? 'Atualizando...' : 'Atualizar status'}
          </button>
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'GRACE_PERIOD' ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Há um pagamento pendente até {formatDate(summary.account?.gracePeriodEndsAt ?? null)}. Regularize pela seção Pagamento para manter o acesso sem restrições.
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'RESTRICTED' ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          O acesso está restrito por pagamento pendente. Regularize na seção Pagamento para liberar novas ações.
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'CANCELED' && !cancellationNotice ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Sua assinatura foi encerrada e o acesso ao plano terminou.
        </InfoCallout>
      ) : null}

      {billingSuccessNotice ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {billingSuccessNotice}
        </InfoCallout>
      ) : pendingChange && !isCancellationPendingChange ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {getPlanChangeLabel(pendingChange, pendingChange.effectiveAt)}
        </InfoCallout>
      ) : null}

      {setupNotice ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {setupNotice}
        </InfoCallout>
      ) : null}

      {cancellationNotice ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {cancellationNotice}
        </InfoCallout>
      ) : null}

      {trialEndingNotice ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          {trialEndingNotice}
        </InfoCallout>
      ) : summary.account?.status === 'TRIALING' && summary.account.trialEndsAt && !hasScheduledCancellation ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          Seu teste gratuito termina em {formatDate(summary.account.trialEndsAt)}. Se quiser continuar, use “Contratar plano” e confirme o pagamento.
        </InfoCallout>
      ) : null}

      <section className="rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 md:max-w-[510px]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
                Plano
              </h3>
            </div>
            <p className="mt-1 text-sm font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
              Faixa de cobrança
            </p>
            <div className="mt-3 space-y-2">
              <Progress
                value={activeStudentPercent}
                aria-label={planUsageLabel}
                className="h-2.5 bg-[#efefef] alusa-dark:bg-[color:var(--color-bg-card-soft)]"
                indicatorClassName="bg-[#361d56] alusa-dark:bg-[color:var(--color-text-brand)]"
              />
              <div className="flex flex-col gap-1 text-xs text-[#747474] alusa-dark:text-[color:var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between">
                <span>{planUsageLabel}</span>
              </div>
            </div>
            <p className="mt-4 text-[13px] text-[#747474] alusa-dark:text-[color:var(--color-text-secondary)]">
              {renewalLabel}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            {requiresPaymentAttention && hasActiveSubscription && !trialExpired ? (

              <Button
                type="button"
                onClick={() => void openPortal()}
                disabled={!summary.canManage || actionLoading !== null || !summary.account?.stripeCustomerId}
                className="h-[34px] rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
              >
                {actionLoading === 'portal' ? 'Abrindo...' : 'Regularizar pagamento'}
              </Button>
            ) : canStartSelfServiceFlow ? (
              <Button
                type="button"
              onClick={() => {
                if (canStartTrial) void startTrial();
                else if (!confirmedPriceBand) {
                  setPricingStudentCount(Math.max(1, Math.min(500, summary.activeStudents || 165)));
                  setPricingDialogOpen(true);
                } else void startCheckout();
              }}
                disabled={!summary.canManage || checkoutCancelPending || checkoutSuccessBlocksCheckout || actionLoading !== null}
                className="h-[34px] rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
              >
                {actionLoading ? 'Processando...' : canStartTrial ? 'Começar teste grátis' : 'Contratar plano'}
              </Button>
            ) : (!hasActiveSubscription || trialExpired) && commercialTarget?.kind === 'SPECIALIST' ? (
              <a
                href="mailto:contato@alusa.app?subject=Negociacao%20plataforma%20Alusa"
                className="inline-flex h-[34px] items-center rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] hover:bg-[#43236c]"
              >
                Falar com um especialista
              </a>
            ) : null}
            {hasScheduledCancellation ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingCancellationAction('undo_cancel')}
                disabled={!summary.canManage || actionLoading !== null}
                className="h-[34px] rounded-[5px] border-[#cf322a] px-4 text-sm font-medium text-[#9b231d] shadow-none hover:bg-red-50 hover:text-[#9b231d] alusa-dark:border-red-400/60 alusa-dark:bg-transparent alusa-dark:text-red-200 alusa-dark:hover:bg-red-500/10"
              >
                Reverter cancelamento
              </Button>
            ) : hasManageableSubscription && summary.account?.id ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingCancellationAction('cancel_at_period_end')}
                disabled={!summary.canManage || actionLoading !== null}
                className="h-[34px] rounded-[5px] border-[#cf322a] px-4 text-sm font-medium text-[#9b231d] shadow-none hover:bg-red-50 hover:text-[#9b231d] alusa-dark:border-red-400/60 alusa-dark:bg-transparent alusa-dark:text-red-200 alusa-dark:hover:bg-red-500/10"
              >
                Cancelar assinatura
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-6 rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:grid-cols-[1fr_auto] md:items-start md:px-6">
        <div>
          <h3 className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
            Pagamento
          </h3>
          <div className="mt-8 flex items-center gap-2 text-sm">
            {paymentMethod.status === 'present' ? <CardBrandMark brand={paymentMethod.brand} /> : null}
            <div className="space-y-0.5">
              <p className="font-medium text-[#26222d] alusa-dark:text-[color:var(--color-text-primary)]">
                {paymentTitle}
              </p>
              {paymentDescription ? (
                <p className="text-xs text-[#747474] alusa-dark:text-[color:var(--color-text-secondary)]">
                  {paymentDescription}
                </p>
              ) : null}
            </div>
          </div>
          {summary?.savedTrialPaymentMethod ? (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-950 alusa-dark:bg-violet-500/10 alusa-dark:text-violet-100">
              <CardBrandMark brand={summary.savedTrialPaymentMethod.brand} />
              <div>
                <p className="font-medium">Cartão salvo para contratação</p>
                <p className="text-xs opacity-80">{formatCardBrand(summary.savedTrialPaymentMethod.brand)} •••• {summary.savedTrialPaymentMethod.last4}. Não é o método padrão de cobrança.</p>
              </div>
            </div>
          ) : null}
        </div>

        {!trialExpired ? (

          <div className="flex flex-col items-end gap-3">
            {isTrialing ? (
              <label className="max-w-2xl text-xs leading-5 text-[#57515f] alusa-dark:text-[color:var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  className="mr-2 align-middle"
                  checked={trialCardConsent}
                  onChange={(event) => setTrialCardConsent(event.target.checked)}
                />
                Autorizo salvar este cartão para futuras cobranças recorrentes mensais da assinatura Alusa. O valor depende da faixa de alunos ativos e será exibido antes de eu confirmar a contratação paga. Este cadastro não inicia assinatura nem cobrança, e o trial não será convertido automaticamente. O cancelamento da assinatura paga vale ao fim do período vigente.
              </label>
            ) : null}
            <Button
              type="button"
              onClick={() => void openPortal({ newTab: true })}
              disabled={!summary.canManage || actionLoading !== null || !summary.account?.stripeCustomerId || (isTrialing && !trialCardConsent)}
              className="h-[34px] rounded-[5px] bg-[#512a82] px-4 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
            >
              {actionLoading === 'portal' ? 'Abrindo...' : paymentActionLabel}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:grid-cols-[1fr_auto] md:items-start md:px-6">
        <div>
          <h3 className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
            Informações de faturamento
          </h3>
          <div className="mt-8 space-y-1 text-sm">
            <p className="font-medium text-[#26222d] alusa-dark:text-[color:var(--color-text-primary)]">
              {summary.billingInfo.contaName}
            </p>
            <p className="text-xs text-[#747474] alusa-dark:text-[color:var(--color-text-secondary)]">
              {summary.billingInfo.email ?? 'E-mail não informado'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="h-[34px] rounded-[5px] bg-[#512a82] px-4 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
          >
            Histórico de faturamento
          </Button>
        </div>
      </section>

      <BillingHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        invoices={summary.invoices}
      />

      <Dialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen}>
        <DialogContent className="max-w-[920px] gap-0 overflow-hidden border-[#e3ddea] p-5 sm:p-7">
          <DialogHeader>
            <DialogTitle className="max-w-[560px] text-left text-xl font-semibold leading-6 text-[#17121c]">Quantos alunos pagantes sua escola tem hoje?</DialogTitle>
            <DialogDescription className="mt-3 max-w-[600px] text-left text-sm leading-6 text-[#6f6878]">Confira a faixa e a mensalidade da contratação antes de continuar para o pagamento.</DialogDescription>
          </DialogHeader>
          {(() => {
            const target = resolveSchoolCommercialTarget(pricingStudentCount);
            const band = target?.kind === 'SELF_SERVICE' ? target.band : null;
            return (
              <section className="mt-6 grid overflow-hidden rounded-lg border border-[#e3ddea] bg-white md:grid-cols-2" aria-label="Simulador de mensalidade">
                <div className="grid content-center gap-4 p-5 sm:p-7">
                  <div>
                    <label htmlFor="platform-pricing-count" className="text-base font-semibold text-[#17121c]">Alunos pagantes</label>
                    <p id="platform-pricing-count-help" className="mt-1 text-sm leading-5 text-[#6f6878]">Conte cada aluno uma vez, mesmo que tenha várias matrículas. Inclua bolsas parciais e mensalidades em atraso. Não inclua alunos que tenham apenas bolsa integral.</p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <output htmlFor="platform-pricing-count" className="text-4xl font-semibold tracking-tight text-[#17121c]">{pricingStudentCount > 500 ? 'Mais de 500' : pricingStudentCount}</output>
                    <span className="text-sm text-[#6f6878]">alunos</span>
                  </div>
                  <input id="platform-pricing-count" type="range" min={1} max={501} step={1}
                    value={Math.min(pricingStudentCount, 501)}
                    onChange={(event) => setPricingStudentCount(Number(event.currentTarget.value))}
                    aria-describedby="platform-pricing-count-help" aria-valuetext={pricingStudentCount > 500 ? 'Mais de 500 alunos' : `${pricingStudentCount} alunos`}
                    style={{ '--pricing-range-progress': `${((Math.min(pricingStudentCount, 501) - 1) / 500) * 100}%`, height: 8, margin: 0 } as React.CSSProperties}
                    className="pricing-range focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#55298a]" />
                  <div className="flex justify-between text-xs text-[#7b7484]" aria-hidden="true"><span>1 aluno</span><span>Mais de 500 alunos</span></div>
                </div>
                <div className="grid content-center gap-4 border-t border-[#e3ddea] bg-[#fbfafd] p-5 sm:p-7 md:border-l md:border-t-0">
                  <div>
                    <p className="text-sm font-semibold text-[#6f6878]">{band?.label ?? 'Mais de 500 alunos'}</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-[#17121c]" aria-hidden="true">
                      <span className="inline-flex items-baseline tabular-nums">
                        {band ? <><span className="mr-[0.12em]">R$</span><span><SlidingNumber value={band.amountCents / 100} />,00</span></> : <span>Condição personalizada</span>}
                        <span className="ml-1 text-sm font-medium text-[#6f6878]">/mês</span>
                      </span>
                    </p>
                    <span className="sr-only" aria-live="polite" aria-atomic="true">{band ? `${band.label}, ${(band.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por mês.` : 'Mais de 500 alunos, condição personalizada.'}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-[#211b27]">Todos os módulos essenciais incluídos.</p>
                    <p className="mt-1 text-sm leading-5 text-[#6f6878]">O valor só muda após 3 meses consecutivos em outra faixa.</p>
                  </div>
                  <div className="rounded-md bg-[#f0e7fa] p-3 text-sm leading-5 text-[#4d4557]">
                    <p>Ao confirmar, você seguirá para o pagamento da contratação. Nenhuma cobrança é iniciada sem sua confirmação no Stripe.</p>
                  </div>
                </div>
              </section>
            );
          })()}
          <DialogFooter className="mt-5">
            {pricingStudentCount > 500 ? (
              <a href="mailto:contato@alusa.app?subject=Negociacao%20plataforma%20Alusa" className="inline-flex h-10 items-center rounded-md bg-[#512a82] px-4 text-sm font-medium text-white">Falar com um especialista</a>
            ) : (
              <Button type="button" disabled={actionLoading !== null || checkoutSuccessBlocksCheckout} onClick={() => { setPricingDialogOpen(false); void startCheckout(pricingStudentCount); }}>
                {actionLoading === 'checkout' ? 'Abrindo pagamento...' : 'Confirmar e continuar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingCancellationAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancellationAction(null);
        }}
        title={pendingCancellationAction === 'undo_cancel' ? 'Reverter cancelamento?' : 'Cancelar assinatura?'}
        description={pendingCancellationAction === 'undo_cancel'
          ? 'A assinatura continuará ativa e a próxima cobrança seguirá conforme o ciclo atual.'
          : 'A conta mantém acesso até o fim do período atual. Nenhum dado educacional será apagado.'}
        confirmText={pendingCancellationAction === 'undo_cancel' ? 'Reverter cancelamento' : 'Cancelar assinatura'}
        cancelText="Voltar"
        variant={pendingCancellationAction === 'cancel_at_period_end' ? 'destructive' : 'default'}
        onConfirm={() => {
          if (pendingCancellationAction) void requestCancellation(pendingCancellationAction);
        }}
        loading={actionLoading === pendingCancellationAction}
      />

      <BillingNoticeDialog
        notice={noticeDialog}
        onOpenChange={(open) => {
          if (!open) setNoticeDialog(null);
        }}
        onAction={(action) => {
          setNoticeDialog(null);
          if (action === 'portal') void openPortal();
        }}
      />
      {showCheckoutResume && !checkoutCancelPending && summary.canManage && (canStartSelfServiceFlow || resumeStudentCount !== null) ? (
        <CheckoutResumePopup
          placement="top-right"
          loading={actionLoading === 'checkout'}
          onDismiss={dismissCheckoutResume}
          onResume={() => {
            setShowCheckoutResume(false);
            if (summary.canManage && !checkoutCancelPending && actionLoading === null) {
              if (!confirmedPriceBand) {
                setPricingStudentCount(resumeStudentCount ?? Math.max(1, Math.min(500, summary.activeStudents || 165)));
                setPricingDialogOpen(true);
              } else void startCheckout();
            }
          }}
        />
      ) : null}
    </div>
  );

  function dismissCheckoutResume() {
    setShowCheckoutResume(false);
  }
}

export function navigateToSetupCheckout(
  destinationUrl: string,
  checkoutWindow: Window | null,
  sameTabNavigate: (url: string) => void = (url) => window.location.assign(url),
): 'popup' | 'same-tab' {
  if (checkoutWindow) {
    checkoutWindow.location.href = destinationUrl;
    return 'popup';
  }
  sameTabNavigate(destinationUrl);
  return 'same-tab';
}

function consumeCheckoutCancelQuery(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('checkout') !== 'cancel') return;
  url.searchParams.delete('checkout');
  url.searchParams.delete('studentCount');
  url.searchParams.delete('checkoutRequestKey');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function consumeCheckoutSuccessQuery(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('checkout') !== 'success') return;
  url.searchParams.delete('checkout');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function consumeSetupQuery(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('setup') !== 'success' && url.searchParams.get('setup') !== 'canceled') return;
  url.searchParams.delete('setup');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function readCheckoutStudentCount(): number | null {
  const value = new URL(window.location.href).searchParams.get('studentCount');
  if (!value || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= 500 ? count : null;
}

function readCheckoutRequestKey(): string | null {
  const value = new URL(window.location.href).searchParams.get('checkoutRequestKey');
  return value && value.length <= 128 && value.trim() === value && /^[A-Za-z0-9:_-]+$/.test(value)
    ? value
    : null;
}

function isTerminalCheckoutCancelState(state: string): state is 'CANCELED' | 'ALREADY_CANCELED' | 'STALE' {
  return state === 'CANCELED' || state === 'ALREADY_CANCELED' || state === 'STALE';
}

function BillingHistoryDialog({
  open,
  onOpenChange,
  invoices,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  invoices: BillingInvoice[];
}) {
  const nextPaymentAttempt = useMemo(() => invoices
    .filter((invoice) => invoice.status === 'OPEN' && invoice.nextPaymentAttempt)
    .map((invoice) => invoice.nextPaymentAttempt!)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null, [invoices]);

  const columns = useMemo<DataTableColumn<BillingInvoice>[]>(() => [
    {
      id: 'product',
      header: 'Produto',
      width: 'w-[18%]',
      align: 'left',
      cellClassName: 'font-medium',
      render: (invoice) => (
        <span className="text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          {invoice.planCode ? planName(invoice.planCode) : 'Alusa'}
        </span>
      ),
    },
    {
      id: 'reference',
      header: 'Referência',
      width: 'w-[24%]',
      align: 'left',
      cellClassName: 'font-mono text-[13px] text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]',
      render: (invoice) => invoice.number ?? 'Fatura Alusa',
    },
    {
      id: 'date',
      header: 'Data',
      width: 'w-[14%]',
      align: 'left',
      render: (invoice) => formatDate(invoice.paidAt ?? invoice.failedAt ?? invoice.periodEnd ?? invoice.periodStart),
    },
    {
      id: 'amount',
      header: 'Valor',
      width: 'w-[12%]',
      align: 'left',
      cellClassName: 'font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]',
      render: (invoice) => formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency),
    },
    {
      id: 'status',
      header: 'Estado',
      width: 'w-[14%]',
      align: 'left',
      render: (invoice) => (
        <Badge variant={getInvoiceBadgeVariant(invoice)} size="sm">
          {getInvoiceStatusLabel(invoice)}
        </Badge>
      ),
    },
    {
      id: 'download',
      header: 'Baixar',
      width: 'w-[18%]',
      align: 'left',
      render: (invoice) => (
        invoice.invoicePdf || invoice.hostedInvoiceUrl ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            onClick={(event) => event.stopPropagation()}
            className="h-8 rounded-lg border-gray-200 px-3 text-xs font-medium shadow-none alusa-dark:border-[color:var(--color-border-default)]"
          >
            <a
              href={invoice.invoicePdf ?? invoice.hostedInvoiceUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
            >
              {invoice.invoicePdf ? <Download className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
              Baixar
            </a>
          </Button>
        ) : (
          <span className="text-gray-400">Indisponível</span>
        )
      ),
    },
  ], []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[960px] gap-5 rounded-2xl p-6 sm:p-7">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-xl font-semibold text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]">
            Histórico de faturamento
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            <span>Consulte as faturas registradas da assinatura da Alusa.</span>
            {nextPaymentAttempt ? (
              <span className="font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-primary)]">
                Próxima tentativa: {formatDate(nextPaymentAttempt)}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DataTable
          columns={columns}
          data={invoices}
          rowKey={(invoice) => invoice.id}
          emptyMessage={
            <div className="px-6 py-12 text-center text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              Nenhuma fatura registrada ainda.
            </div>
          }
          ariaLabel="Histórico de faturamento"
          paginate
          pageSize={10}
          containerClassName="rounded-xl border border-gray-200 alusa-dark:border-[color:var(--color-border-default)]"
          tableClassName="min-w-0"
        />
      </DialogContent>
    </Dialog>
  );
}

function BillingNoticeDialog({
  notice,
  onOpenChange,
  onAction,
}: {
  notice: NoticeDialogState;
  onOpenChange: (_open: boolean) => void;
  onAction: (_action: NonNullable<NoticeDialogState>['action']) => void;
}) {
  return (
    <Dialog open={notice !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{notice?.title ?? 'Atenção'}</DialogTitle>
          <DialogDescription>{notice?.description ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {notice?.action && notice.actionLabel ? (
            <Button
              type="button"
              onClick={() => onAction(notice.action)}
              className={cn(
                'bg-[#512a82] text-[#f9f4fe] hover:bg-[#43236c]',
                notice.tone === 'destructive' && 'bg-[#9b231d] hover:bg-[#7f1d1d]',
              )}
            >
              {notice.actionLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LEGACY_PLAN_RANK: Record<'STARTER' | 'PREMIUM' | 'PRO' | 'CUSTOM', number> = {
  STARTER: 0,
  PREMIUM: 2,
  PRO: 6,
  CUSTOM: 0,
};

export function getPlanRank(code: PlanCode) {
  return isSchoolPriceBandCode(code)
    ? getSchoolPriceBandRank(code)
    : LEGACY_PLAN_RANK[code];
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

function getPaymentMethodTitle(paymentMethod: PaymentMethodSummary) {
  if (paymentMethod.status === 'unknown') return 'Pagamento indisponível';
  if (paymentMethod.status === 'missing') return 'Nenhuma forma de pagamento cadastrada';

  const brand = formatCardBrand(paymentMethod.brand);
  return `${brand} •••• ${paymentMethod.last4}`;
}

function getPaymentMethodDescription(paymentMethod: PaymentMethodSummary) {
  if (paymentMethod.status === 'unknown') return 'Não foi possível consultar a forma de pagamento agora.';
  if (paymentMethod.status === 'missing') return 'O período de teste não exige cartão. A contratação exige confirmação e pagamento.';

  const expiry = formatCardExpiry(paymentMethod.expMonth, paymentMethod.expYear);
  return expiry ? `Vence em ${expiry}` : null;
}

function formatCardExpiry(month: number | null, year: number | null) {
  if (!month || !year) return null;
  return `${String(month).padStart(2, '0')}/${year}`;
}

function formatCompetence(value: string | null) {
  if (!value) return 'competência mensal';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return 'competência mensal';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}

function formatLongDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function getRenewalLabel(account: BillingAccount | null, paymentMethod: PaymentMethodSummary) {
  if (!account) return 'Assinatura ainda não iniciada.';
  if (account.status === 'CANCELED') return 'Assinatura cancelada.';
  const trialDate = formatLongDate(account.trialEndsAt);
  const date = formatLongDate(account.currentPeriodEnd);
  if (account.cancelAtPeriodEnd && date) return `Sua assinatura será encerrada em ${date}.`;
  if (account.status === 'TRIALING' && trialDate) {
    return `O teste termina em ${trialDate}. A contratação exige uma confirmação e pagamento explícitos.`;
  }
  if (account.status === 'ACTIVE' && date && paymentMethod.status === 'present' && !account.cancelAtPeriodEnd) {
    return `Próxima cobrança prevista para ${date}.`;
  }
  if (account.status === 'ACTIVE' && date) return 'Cadastre um cartão para ativar a renovação automática do seu plano.';
  return getBillingStatusLabel(account.status);
}

function getCancellationNotice(account: BillingAccount | null) {
  if (!account?.cancelAtPeriodEnd) return null;
  if (account.status === 'CANCELED' || account.accessStatus === 'CANCELED') {
    return 'Sua assinatura foi encerrada e o acesso ao plano terminou.';
  }

  const accessDate = formatDate(account.currentPeriodEnd ?? account.trialEndsAt);
  if (accessDate === '-') {
    return 'O cancelamento está agendado para o fim do período atual. Você pode reverter na seção Plano se quiser manter o plano.';
  }

  if (account.status === 'TRIALING') {
    return `Seu cancelamento está agendado. O teste gratuito continua até ${accessDate}; você pode reverter na seção Plano.`;
  }

  return `O cancelamento está agendado para ${accessDate}. Você pode reverter na seção Plano se quiser manter o plano.`;
}

function planName(code: PlanCode) {
  if (isSchoolPriceBandCode(code)) return SCHOOL_PRICE_BANDS.find((band) => band.code === code)?.name ?? 'Alusa';
  if (code === 'STARTER' || code === 'PREMIUM' || code === 'PRO') return 'Plano anterior';
  return 'Personalizado';
}

function getBillingStatusLabel(status: BillingStatus) {
  switch (status) {
    case 'ACTIVE':
      return 'Ativa';
    case 'TRIALING':
      return 'Em teste';
    case 'CHECKOUT_PENDING':
      return 'Contratação aguardando pagamento';
    case 'PAST_DUE':
      return 'Pagamento pendente';
    case 'CANCELED':
      return 'Cancelada';
    case 'UNPAID':
      return 'Inadimplente';
    case 'PAUSED':
      return 'Pausada';
    case 'INCOMPLETE':
    case 'INCOMPLETE_EXPIRED':
      return 'Incompleta';
    default:
      return 'Não iniciada';
  }
}

export function getPlanChangeLabel(change: BillingSummary['planChanges'][number], effectiveAt: string | null) {
  const target = change.toPlanCode ? planName(change.toPlanCode) : 'novo plano';
  if (change.type === 'UPGRADE') {
    if (change.status === 'PENDING_EFFECTIVE_DATE') {
      return effectiveAt
        ? `A faixa do plano será atualizada para ${target} na renovação em ${formatDate(effectiveAt)}.`
        : `A faixa do plano será atualizada para ${target} na próxima renovação.`;
    }
    return `Alteração para ${target} aguarda confirmação do pagamento.`;
  }
  if (change.type === 'DOWNGRADE') {
    const current = change.fromPlanCode ? planName(change.fromPlanCode) : 'plano atual';
    return effectiveAt
      ? `Seu plano ${current} continua ativo até ${formatDate(effectiveAt)} e, a partir dessa data, sua conta passa para o plano ${target}.`
      : `Seu plano ${current} continua ativo até a renovação e, a partir dela, sua conta passa para o plano ${target}.`;
  }
  if (change.type === 'CANCEL_AT_PERIOD_END') return 'Assinatura cancelada. O acesso continua até o fim do período atual.';
  return 'Alteração de plano pendente.';
}

function getInvoiceStatusLabel(invoice: BillingInvoice) {
  if (isFreeTrialInvoice(invoice)) return 'Grátis';
  if (invoice.failedAt && invoice.status === 'OPEN') return 'Falhou';

  switch (invoice.status) {
    case 'PAID':
      return 'Pago';
    case 'OPEN':
      return 'Aberta';
    case 'DRAFT':
      return 'Rascunho';
    case 'VOID':
      return 'Cancelada';
    case 'UNCOLLECTIBLE':
      return 'Incobrável';
    default:
      return 'Desconhecida';
  }
}

function isFreeTrialInvoice(invoice: BillingInvoice) {
  return invoice.status === 'PAID' && invoice.amountPaid === 0 && invoice.amountDue === 0;
}

function getInvoiceBadgeVariant(invoice: BillingInvoice): BadgeVariant {
  if (invoice.failedAt && invoice.status === 'OPEN') return 'destructive';

  switch (invoice.status) {
    case 'PAID':
      return 'success';
    case 'OPEN':
    case 'DRAFT':
      return 'warning';
    case 'VOID':
    case 'UNCOLLECTIBLE':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function getTrialEndingNotice(
  account: BillingAccount | null,
  plan: { name: string; amountCents: number | null } | null,
) {
  if (!account || account.status !== 'TRIALING' || !account.trialEndsAt || account.cancelAtPeriodEnd) return null;

  const trialEndsAt = new Date(account.trialEndsAt);
  const trialEndDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(trialEndsAt);
  const commercialTerms = plan?.amountCents !== null && plan?.amountCents !== undefined
    ? `${plan.name}, ${formatMoney(plan.amountCents, 'brl')}/mês`
    : 'a faixa atual de alunos';
  const msUntilEnd = trialEndsAt.getTime() - Date.now();
  if (msUntilEnd <= 0) {
    return `Seu teste gratuito terminou em ${trialEndDate}. A condição atual é ${commercialTerms}. Use “Contratar plano” e confirme o pagamento para continuar usando as operações.`;
  }

  const daysUntilEnd = Math.ceil(msUntilEnd / (24 * 60 * 60 * 1000));
  if (daysUntilEnd > 3) return null;

  return `Seu teste gratuito termina em ${daysUntilEnd} ${daysUntilEnd === 1 ? 'dia' : 'dias'} (${trialEndDate}). A condição atual é ${commercialTerms}. Se quiser continuar, use “Contratar plano” e confirme o pagamento.`;
}



