'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Check, ChevronRight, Download, ExternalLink } from '@/components/icons/icons';
import {
  type PlatformBillingSummaryDTO,
  type PublicPlatformPlanDTO,
} from './dtos/platform-billing-summary';
import { usePlatformBilling } from './PlatformBillingContext';

type PlanCode = 'STARTER' | 'PREMIUM' | 'PRO' | 'CUSTOM';
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

type PublicPlan = PublicPlatformPlanDTO;

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

type NoticeDialogState = {
  title: string;
  description: string;
  tone?: 'default' | 'destructive';
  actionLabel?: string;
  action?: 'portal' | 'plans';
} | null;

type PendingPlanAction = {
  planCode: PublicPlan['code'];
  type: 'upgrade' | 'downgrade';
  title: string;
  description: string;
} | null;

export function PlatformBillingFeature({ checkoutState }: { checkoutState?: CheckoutState }) {
  const { summary, loading, refresh } = usePlatformBilling();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialogState>(null);
  const [pendingPlanAction, setPendingPlanAction] = useState<PendingPlanAction>(null);
  const [pendingCancellationAction, setPendingCancellationAction] = useState<'cancel_at_period_end' | 'undo_cancel' | null>(null);

  useEffect(() => {
    if (checkoutState === 'cancel') {
      setNoticeDialog({
        title: 'Pagamento cancelado',
        description: 'Nenhuma alteração foi aplicada ao plano da conta.',
      });
    }
  }, [checkoutState]);

  const currentPlan = useMemo(() => {
    if (!summary?.account?.planCode) return null;
    return summary.plans.find((plan) => plan.code === summary.account?.planCode) ?? null;
  }, [summary]);

  const currentPlanMax = currentPlan?.maxActiveStudents ?? null;
  const activeStudentPercent = currentPlanMax
    ? Math.min(100, Math.round((summary?.activeStudents ?? 0) / currentPlanMax * 100))
    : 0;
  const pendingChangeRaw = summary?.planChanges.find((change) =>
    change.status === 'PENDING_PAYMENT' || change.status === 'PENDING_EFFECTIVE_DATE'
  ) ?? null;
  const pendingChange =
    pendingChangeRaw?.type === 'CANCEL_AT_PERIOD_END' && summary?.account?.cancelAtPeriodEnd === false
      ? null
      : pendingChangeRaw;
  const isCancellationPendingChange = pendingChange?.type === 'CANCEL_AT_PERIOD_END';
  const planUsageLabel = currentPlanMax
    ? `${summary?.activeStudents ?? 0} de ${currentPlanMax} alunos ativos`
    : `${summary?.activeStudents ?? 0} alunos ativos`;
  const paymentMethod = summary?.paymentMethod ?? { status: 'missing' as const };
  const renewalLabel = getRenewalLabel(summary?.account ?? null, paymentMethod);
  const currentAccessStatus = summary?.account?.accessStatus ?? 'PENDING';
  const hasActiveSubscription = Boolean(summary?.account?.stripeSubscriptionId && summary.account.planCode);
  const isCanceledSubscription = summary?.account?.status === 'CANCELED' || summary?.account?.accessStatus === 'CANCELED';
  const isReactivationFlow = isCanceledSubscription && Boolean(summary?.account?.id);
  const blocksPlanActions = Boolean(pendingChange) && !(isReactivationFlow && isCancellationPendingChange);
  const hasManageableSubscription = hasActiveSubscription && !isCanceledSubscription;
  const hasScheduledCancellation = Boolean(summary?.account?.cancelAtPeriodEnd && !isCanceledSubscription);
  const isTrialing = summary?.account?.status === 'TRIALING';
  const canStartTrial = !hasActiveSubscription && !summary?.account?.trialEndsAt;
  const availablePlanChanges = isReactivationFlow
    ? summary?.plans ?? []
    : summary?.plans.filter((plan) => plan.code !== summary.account?.planCode) ?? [];
  const requiresPaymentAttention = Boolean(
    currentAccessStatus === 'GRACE_PERIOD' ||
    currentAccessStatus === 'RESTRICTED' ||
    summary?.account?.status === 'PAST_DUE' ||
    summary?.account?.status === 'UNPAID' ||
    summary?.account?.status === 'INCOMPLETE',
  );
  const paymentTitle = getPaymentMethodTitle(paymentMethod);
  const paymentDescription = getPaymentMethodDescription(paymentMethod);
  const paymentActionLabel = paymentMethod.status === 'present' ? 'Alterar pagamento' : 'Cadastrar pagamento';
  const cancellationNotice = getCancellationNotice(summary?.account ?? null);
  const trialEndingNotice = getTrialEndingNotice(summary?.account ?? null, paymentMethod);
  const planActionLabel = getPlanActionLabel({
    requiresPaymentAttention,
    isTrialing,
    isCanceledSubscription,
    hasManageableSubscription,
    canStartTrial,
  });

  async function startCheckout(planCode: PublicPlan['code']) {
    setActionLoading(`checkout:${planCode}`);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch('/api/platform-billing/checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ planCode, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        checkoutUrl?: string;
        message?: string;
        error?: string;
        activeStudents?: number;
        maxActiveStudents?: number;
      };
      if (!response.ok || !payload.checkoutUrl) {
        const message = payload.error === 'PLANO_INSUFICIENTE'
          ? buildIncompatiblePlanMessage(payload)
          : payload.message ?? payload.error ?? 'Não foi possível abrir o pagamento.';
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

  async function openPortal(options?: { newTab?: boolean }) {
    setActionLoading('portal');
    setError(null);
    try {
      const response = await fetch('/api/platform-billing/portal', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      const payload = (await response.json()) as { portalUrl?: string; error?: string };
      if (!response.ok || !payload.portalUrl) {
        throw new Error(payload.error === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND'
          ? 'Nenhuma assinatura encontrada para esta conta.'
          : 'Não foi possível abrir a área de pagamento.');
      }
      if (options?.newTab) {
        window.open(payload.portalUrl, '_blank', 'noopener,noreferrer');
        setActionLoading(null);
        return;
      }
      window.location.assign(payload.portalUrl);
    } catch (err) {
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

  function selectPlan(planCode: PublicPlan['code']) {
    if (!hasActiveSubscription || summary?.account?.status === 'NOT_STARTED' || summary?.account?.status === 'CANCELED') {
      void startCheckout(planCode);
      return;
    }

    const currentCode = summary?.account?.planCode;
    if (!currentCode || currentCode === 'CUSTOM' || currentCode === planCode) return;

    const type = getPlanRank(planCode) > getPlanRank(currentCode) ? 'upgrade' : 'downgrade';
    const targetPlan = summary.plans.find((plan) => plan.code === planCode);
    const targetName = targetPlan ? getPlanMarketingName(targetPlan.code) : planName(planCode);

    setPendingPlanAction({
      planCode,
      type,
      title: isTrialing ? `Trocar para ${targetName}?` : `Alterar para ${targetName}?`,
      description: isTrialing
        ? `Seu teste gratuito continua até ${formatDate(summary.account?.trialEndsAt ?? null)}.`
        : type === 'upgrade'
          ? 'A alteração será concluída após a confirmação do pagamento.'
          : `A mudança entra em vigor no próximo ciclo, se a conta continuar dentro do limite de ${targetPlan?.maxActiveStudents ?? 'alunos'} alunos ativos.`,
    });
  }

  async function requestPlanChange(planCode: PublicPlan['code']) {
    if (!hasActiveSubscription || summary?.account?.status === 'NOT_STARTED' || summary?.account?.status === 'CANCELED') {
      await startCheckout(planCode);
      return;
    }

    setActionLoading(`plan-change:${planCode}`);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch('/api/platform-billing/plan-change', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ targetPlanCode: planCode, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        message?: string;
        detail?: string | null;
        error?: string;
        details?: {
          activeStudents?: number;
          maxActiveStudents?: number;
          recommendedPlanCode?: string;
        };
      };
      if (!response.ok) {
        const message = payload.error === 'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE'
          ? buildIncompatiblePlanMessage(payload.details)
          : payload.message ?? 'Falha ao solicitar mudança de plano.';
        throw new Error(message);
      }
      setPlansOpen(false);
      setPendingPlanAction(null);
      setNoticeDialog({
        title: payload.message ?? 'Plano alterado com sucesso',
        description: payload.detail ?? 'A alteração foi registrada.',
      });
      await refresh(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao solicitar mudança de plano.';
      setError(message);
      setNoticeDialog({
        title: 'Mudança não concluída',
        description: message,
        tone: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function requestCancellation(action: 'cancel_at_period_end' | 'undo_cancel') {
    setActionLoading(action);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
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

  if (loading) {
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

      {checkoutState === 'cancel' ? (
        <InfoCallout variant="info" size="sm" showIcon>
          Pagamento cancelado. Nenhuma alteração foi aplicada.
        </InfoCallout>
      ) : null}

      {error ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Ação não concluída. Tente novamente ou atualize o pagamento quando aplicável.
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'GRACE_PERIOD' ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Pagamento pendente até {formatDate(summary.account?.gracePeriodEndsAt ?? null)}.
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'RESTRICTED' ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Conta restrita. Regularize para liberar novas ações.
        </InfoCallout>
      ) : null}

      {currentAccessStatus === 'CANCELED' && !cancellationNotice ? (
        <InfoCallout variant="warning" size="sm" showIcon>
          Assinatura cancelada. O acesso ao plano foi encerrado.
        </InfoCallout>
      ) : null}

      {pendingChange && !isCancellationPendingChange ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {getPlanChangeLabel(pendingChange, pendingChange.effectiveAt)}
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
          Teste gratuito ativo até {formatDate(summary.account.trialEndsAt)}. A cobrança começa automaticamente após esse período.
        </InfoCallout>
      ) : null}

      {summary.issues.length > 0 ? (
        <InfoCallout
          variant={summary.issues.some((issue) => issue.severity === 'CRITICAL') ? 'warning' : 'info'}
          size="sm"
          showIcon
        >
          Atenção: identificamos uma pendência no faturamento da conta.
        </InfoCallout>
      ) : null}

      <section className="rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 md:max-w-[510px]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
                Plano
              </h3>
              <span className="rounded-full bg-[#f9f4fe] px-3 py-0.5 text-[11px] text-black alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-brand)]">
                {currentPlan?.name ?? 'Sem plano'}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
              Consumo do plano
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
            <Button
              type="button"
              onClick={() => requiresPaymentAttention ? void openPortal() : setPlansOpen(true)}
              disabled={!summary.canManage || actionLoading !== null || (!requiresPaymentAttention && (blocksPlanActions || availablePlanChanges.length === 0))}
              className="h-[34px] rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
            >
              {planActionLabel}
            </Button>
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
          <div className="mt-8 space-y-1 text-sm">
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

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            onClick={() => void openPortal({ newTab: true })}
            disabled={!summary.canManage || actionLoading !== null || !summary.account?.stripeCustomerId}
            className="h-[34px] rounded-[5px] bg-[#512a82] px-4 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
          >
            {actionLoading === 'portal' ? 'Abrindo...' : paymentActionLabel}
          </Button>
        </div>
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

      <PlanChangeDialog
        open={plansOpen}
        onOpenChange={setPlansOpen}
        summary={summary}
        canStartTrial={canStartTrial}
        actionLoading={actionLoading}
        pendingChange={blocksPlanActions}
        isReactivationFlow={isReactivationFlow}
        onPlanChange={selectPlan}
        onOpenPortal={() => void openPortal()}
      />

      <BillingHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        invoices={summary.invoices}
      />

      <ConfirmDialog
        open={pendingPlanAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlanAction(null);
        }}
        title={pendingPlanAction?.title ?? 'Confirmar mudança de plano'}
        description={pendingPlanAction?.description ?? 'Confirme para continuar.'}
        confirmText={isTrialing ? 'Trocar plano' : 'Alterar plano'}
        cancelText="Voltar"
        onConfirm={() => {
          if (pendingPlanAction) void requestPlanChange(pendingPlanAction.planCode);
        }}
        loading={actionLoading?.startsWith('plan-change:') ?? false}
      />

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
          if (action === 'plans') setPlansOpen(true);
        }}
      />
    </div>
  );
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
        <div className="space-y-1">
          <Badge variant={getInvoiceBadgeVariant(invoice)} size="sm">
            {getInvoiceStatusLabel(invoice)}
          </Badge>
          {invoice.nextPaymentAttempt && invoice.status === 'OPEN' ? (
            <p className="text-[11px] text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              Próxima tentativa {formatDate(invoice.nextPaymentAttempt)}
            </p>
          ) : null}
        </div>
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
          <DialogDescription className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            Consulte as faturas registradas da assinatura da Alusa.
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

function PlanChangeDialog({
  open,
  onOpenChange,
  summary,
  canStartTrial,
  actionLoading,
  pendingChange,
  isReactivationFlow,
  onPlanChange,
  onOpenPortal,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  summary: BillingSummary;
  canStartTrial: boolean;
  actionLoading: string | null;
  pendingChange: boolean;
  isReactivationFlow: boolean;
  onPlanChange: (_planCode: PublicPlan['code']) => void;
  onOpenPortal: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-32px)] max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[1120px] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-[24px] border-0 bg-[#26113f] p-0 text-white shadow-2xl will-change-[transform,opacity] data-[state=open]:animate-modal-expand-in data-[state=closed]:animate-modal-shrink-out motion-reduce:animate-none md:h-[calc(100dvh-48px)] md:max-h-[calc(100dvh-48px)] md:w-[calc(100vw-48px)]">
        <div
          className="h-full min-h-0 overflow-y-scroll px-5 py-8 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#9b6bc8] [&::-webkit-scrollbar-thumb:hover]:bg-[#b184dc] [&::-webkit-scrollbar-track]:bg-[#32164e] sm:px-8 md:px-12 md:py-10 lg:px-16"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#9b6bc8 #32164e' }}
        >
          <DialogHeader className="max-w-[620px] space-y-3 text-left">
            <DialogTitle className="text-[36px] font-normal leading-none tracking-[-0.03em] text-white md:text-[44px]">
              Escolha seu plano
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#ded0ec]">
              Selecione a capacidade ideal para sua escola. Você pode mudar de plano conforme sua base de alunos cresce.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-10 space-y-5">
            {summary.plans.map((plan) => {
              const current = summary.account?.planCode === plan.code;
              const exceeds = summary.activeStudents > plan.maxActiveStudents;
              const currentBlocked = current && !isReactivationFlow;
              const disabled = !summary.canManage || currentBlocked || exceeds || actionLoading !== null || pendingChange;
              const displayName = getPlanMarketingName(plan.code);
              const benefits = plan.includedFeatures.length > 0
                ? plan.includedFeatures
                : [
                  'Plataforma completa',
                  'Usuários internos ilimitados',
                  'Professores ilimitados',
                  'Cadastros históricos ilimitados',
                  'Todos os módulos inclusos',
                ];

              return (
                <section
                  key={plan.code}
                  className={cn(
                    'grid gap-8 rounded-[18px] bg-[#fbf9fd] px-6 py-6 text-[#2d2038] md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] md:px-8 md:py-7',
                    current && 'bg-[#dcbcff]',
                  )}
                >
                  <div className="flex min-w-0 flex-col items-start">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-medium">{displayName}</h4>
                      {current ? (
                        <Badge variant={isReactivationFlow ? 'neutral' : 'success'}>
                          {isReactivationFlow ? 'Anterior' : 'Atual'}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <span className="text-[42px] font-normal leading-none tracking-[-0.04em] md:text-[48px]">
                        {formatMoney(plan.amountCents, plan.currency)}
                      </span>
                      <span className="pb-1 text-sm text-[#66576f]">por mês</span>
                    </p>
                    <p className="mt-5 max-w-[390px] text-sm leading-5 text-[#43364c]">
                      Até {plan.maxActiveStudents} alunos. {getPlanDescription(plan.code)}
                    </p>

                    {exceeds ? (
                      <p className="mt-4 text-xs font-medium text-[#8f1f52]">
                        A conta possui {summary.activeStudents} alunos ativos.
                      </p>
                    ) : null}

                    <Button
                      type="button"
                      disabled={disabled}
                      onClick={() => onPlanChange(plan.code)}
                      className={cn(
                        'mt-6 h-11 w-auto rounded-full border px-5 text-sm font-medium shadow-none disabled:opacity-100',
                        current
                          ? 'border-[#2d1744] bg-[#2d1744] text-white hover:bg-[#3b1f58]'
                          : 'border-[#3d2b4f] bg-transparent text-[#2d2038] hover:bg-[#eee7f4]',
                      )}
                    >
                      <span>
                        {exceeds
                          ? 'Plano incompatível'
                          : currentBlocked
                            ? 'Plano atual'
                            : actionLoading?.endsWith(`:${plan.code}`)
                              ? 'Processando...'
                              : isReactivationFlow
                                ? 'Reativar assinatura'
                                : canStartTrial
                                  ? getTrialCtaLabel(displayName, plan.trialDays)
                                  : summary.account?.status === 'TRIALING'
                                    ? 'Trocar plano'
                                    : 'Alterar plano'}
                      </span>
                      {!disabled ? <ChevronRight className="ml-2 size-4" aria-hidden="true" /> : null}
                    </Button>
                  </div>

                  <div>
                    <h5 className="text-base font-medium">O que está incluído</h5>
                    <ul className="mt-5 space-y-3">
                      {benefits.slice(0, 5).map((benefit) => (
                        <li key={benefit} className="flex items-start gap-3 text-sm leading-5 text-[#43364c]">
                          <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#512a82] text-white">
                            <Check className="size-3" aria-hidden="true" strokeWidth={2.5} />
                          </span>
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}

            <div className="flex flex-col items-start gap-4 pt-2 text-left">
              <p className="text-sm text-[#ded0ec]">
                <span>Sua escola precisa de mais capacidade?</span>{' '}
                <button type="button" className="font-medium text-white underline underline-offset-4" onClick={onOpenPortal}>
                Solicite um plano personalizado.
                </button>
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={onOpenPortal}
                disabled={!summary.account?.id || actionLoading !== null || !summary.canManage}
                className="border-white/35 bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white disabled:border-white/15 disabled:text-white/45"
              >
                Gerenciar pagamento
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getPlanMarketingName(code: PublicPlan['code']) {
  if (code === 'STARTER') return 'Premium';
  if (code === 'PREMIUM') return 'Premium+';
  return 'Pro';
}

function getPlanRank(code: Exclude<PlanCode, 'CUSTOM'> | PlanCode) {
  if (code === 'STARTER') return 1;
  if (code === 'PREMIUM') return 2;
  if (code === 'PRO') return 3;
  return 4;
}

function buildIncompatiblePlanMessage(details?: {
  activeStudents?: number;
  maxActiveStudents?: number;
  recommendedPlanCode?: string;
}) {
  const usage = typeof details?.activeStudents === 'number'
    ? `A conta possui ${details.activeStudents} alunos ativos`
    : 'A conta possui alunos ativos acima do limite';
  const limit = typeof details?.maxActiveStudents === 'number'
    ? ` e o plano escolhido permite até ${details.maxActiveStudents}`
    : '';
  const recommended = details?.recommendedPlanCode
    ? ` Plano recomendado: ${planName(details.recommendedPlanCode as PlanCode)}.`
    : '';

  return `${usage}${limit}.${recommended}`;
}

function getPlanDescription(code: PublicPlan['code']) {
  if (code === 'STARTER') return 'Ideal para escolas em fase inicial ou com menor volume de alunos.';
  if (code === 'PREMIUM') return 'Para escolas em crescimento que precisam de mais capacidade.';
  return 'Para escolas com maior volume de alunos e uma rotina mais completa.';
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
  return `${brand} final ${paymentMethod.last4}`;
}

function getPaymentMethodDescription(paymentMethod: PaymentMethodSummary) {
  if (paymentMethod.status === 'unknown') return 'Não foi possível consultar a forma de pagamento agora.';
  if (paymentMethod.status === 'missing') return 'Cadastre um cartão para a cobrança automática após o teste.';

  const expiry = formatCardExpiry(paymentMethod.expMonth, paymentMethod.expYear);
  return expiry ? `Validade ${expiry}` : null;
}

function getTrialCtaLabel(displayName: string, trialDays: number | null | undefined) {
  if (!Number.isInteger(trialDays) || !trialDays || trialDays <= 0) {
    return 'Começar teste grátis';
  }

  return `Testar ${displayName} por ${trialDays} dias`;
}

function getPlanActionLabel(input: {
  requiresPaymentAttention: boolean;
  isTrialing: boolean;
  isCanceledSubscription: boolean;
  hasManageableSubscription: boolean;
  canStartTrial: boolean;
}) {
  if (input.requiresPaymentAttention) return 'Regularizar pagamento';
  if (input.isCanceledSubscription) return 'Reativar assinatura';
  if (input.isTrialing) return 'Trocar plano';
  if (input.hasManageableSubscription) return 'Alterar plano';
  return input.canStartTrial ? 'Começar teste grátis' : 'Escolher plano';
}

function formatCardBrand(brand: string | null) {
  if (!brand) return 'Cartão';
  const normalized = brand.toLowerCase();
  if (normalized === 'visa') return 'Visa';
  if (normalized === 'mastercard') return 'Mastercard';
  if (normalized === 'amex') return 'American Express';
  if (normalized === 'elo') return 'Elo';
  if (normalized === 'hiper' || normalized === 'hipercard') return 'Hipercard';
  return normalized.replace(/^\w/, (char) => char.toUpperCase());
}

function formatCardExpiry(month: number | null, year: number | null) {
  if (!month || !year) return null;
  return `${String(month).padStart(2, '0')}/${year}`;
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
  if (account.status === 'TRIALING' && trialDate) {
    return paymentMethod.status === 'present'
      ? `Seu plano será renovado automaticamente em ${trialDate}.`
      : 'Cadastre um cartão para ativar a renovação automática do seu plano.';
  }
  const date = formatLongDate(account.currentPeriodEnd);
  if (account.cancelAtPeriodEnd && date) return `Sua assinatura será encerrada em ${date}.`;
  if (date && paymentMethod.status === 'present') return `Seu plano será renovado automaticamente em ${date}.`;
  if (date) return 'Cadastre um cartão para ativar a renovação automática do seu plano.';
  return getBillingStatusLabel(account.status);
}

function getCancellationNotice(account: BillingAccount | null) {
  if (!account?.cancelAtPeriodEnd) return null;
  if (account.status === 'CANCELED' || account.accessStatus === 'CANCELED') {
    return 'Assinatura cancelada. O acesso ao plano foi encerrado.';
  }

  const accessDate = formatDate(account.currentPeriodEnd ?? account.trialEndsAt);
  if (accessDate === '-') {
    return 'Assinatura cancelada. O acesso continua até o fim do período atual.';
  }

  if (account.status === 'TRIALING') {
    return `Assinatura cancelada. O acesso ao teste gratuito continua até ${accessDate}.`;
  }

  return `Assinatura cancelada. O acesso continua até ${accessDate}.`;
}

function planName(code: PlanCode) {
  if (code === 'STARTER') return 'Starter';
  if (code === 'PREMIUM') return 'Premium';
  if (code === 'PRO') return 'Pro';
  return 'Personalizado';
}

function getBillingStatusLabel(status: BillingStatus) {
  switch (status) {
    case 'ACTIVE':
      return 'Ativa';
    case 'TRIALING':
      return 'Em teste';
    case 'CHECKOUT_PENDING':
      return 'Pagamento pendente';
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

function getPlanChangeLabel(change: BillingSummary['planChanges'][number], effectiveAt: string | null) {
  const target = change.toPlanCode ? planName(change.toPlanCode) : 'novo plano';
  if (change.type === 'UPGRADE') return `Alteração para ${target} aguarda confirmação do pagamento.`;
  if (change.type === 'DOWNGRADE') {
    return effectiveAt
      ? `Plano alterado para ${target}. A mudança entra em vigor em ${formatDate(effectiveAt)}.`
      : `Plano alterado para ${target}. A mudança entra em vigor no próximo ciclo.`;
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

function getTrialEndingNotice(account: BillingAccount | null, paymentMethod: PaymentMethodSummary) {
  if (!account || account.status !== 'TRIALING' || !account.trialEndsAt || account.cancelAtPeriodEnd) return null;
  if (paymentMethod.status === 'present') return null;

  const trialEndsAt = new Date(account.trialEndsAt);
  const msUntilEnd = trialEndsAt.getTime() - Date.now();
  if (msUntilEnd <= 0) {
    return 'O teste gratuito terminou. Cadastre um cartão para manter a assinatura ativa.';
  }

  const daysUntilEnd = Math.ceil(msUntilEnd / (24 * 60 * 60 * 1000));
  if (daysUntilEnd > 3) return null;

  return `Seu teste gratuito termina em ${daysUntilEnd} ${daysUntilEnd === 1 ? 'dia' : 'dias'}. Cadastre um cartão para evitar pausa no acesso.`;
}



