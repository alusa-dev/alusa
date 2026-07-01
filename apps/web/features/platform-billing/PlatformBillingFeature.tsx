'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Download, ExternalLink } from '@/components/icons/icons';

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

type PublicPlan = {
  code: Exclude<PlanCode, 'CUSTOM'>;
  name: string;
  amountCents: number;
  currency: 'brl';
  interval: 'month';
  maxActiveStudents: number;
  publicCheckoutEnabled: true;
  includedFeatures: string[];
};

type BillingAccount = {
  id: string;
  status: BillingStatus;
  accessStatus: 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED';
  planCode: PlanCode | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  gracePeriodEndsAt: string | null;
  restrictedAt: string | null;
  canceledAt: string | null;
  lastPaymentFailedAt: string | null;
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
};

type BillingSummary = {
  environment: 'TEST' | 'LIVE';
  canManage: boolean;
  billingInfo: {
    contaName: string;
    email: string | null;
  };
  activeStudents: number;
  account: BillingAccount | null;
  plans: PublicPlan[];
  invoices: BillingInvoice[];
  planChanges: Array<{
    id: string;
    type: 'UPGRADE' | 'DOWNGRADE' | 'CANCEL_AT_PERIOD_END' | 'UNDO_CANCEL' | 'REACTIVATE' | 'PAYMENT_RECOVERY';
    status: 'PENDING_PAYMENT' | 'PENDING_EFFECTIVE_DATE' | 'APPLIED' | 'CANCELED' | 'FAILED' | 'SUPERSEDED';
    fromPlanCode: PlanCode | null;
    toPlanCode: PlanCode | null;
    effectiveAt: string | null;
    requestedAt: string;
    lastError: string | null;
  }>;
  issues: Array<{
    id: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    code: string;
    title: string;
    message: string;
    detectedAt: string;
  }>;
};

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
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialogState>(null);
  const [pendingPlanAction, setPendingPlanAction] = useState<PendingPlanAction>(null);
  const [pendingCancellationAction, setPendingCancellationAction] = useState<'cancel_at_period_end' | 'undo_cancel' | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-billing/summary', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Falha ao carregar plano e faturamento.');
      setSummary((await response.json()) as BillingSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar plano e faturamento.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

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
  const pendingChange = summary?.planChanges.find((change) =>
    change.status === 'PENDING_PAYMENT' || change.status === 'PENDING_EFFECTIVE_DATE'
  ) ?? null;
  const planUsageLabel = currentPlanMax
    ? `${summary?.activeStudents ?? 0} de ${currentPlanMax} alunos ativos`
    : `${summary?.activeStudents ?? 0} alunos ativos`;
  const renewalLabel = getRenewalLabel(summary?.account ?? null);
  const currentAccessStatus = summary?.account?.accessStatus ?? 'PENDING';
  const hasActiveSubscription = Boolean(summary?.account?.stripeSubscriptionId && summary.account.planCode);
  const availablePlanChanges = summary?.plans.filter((plan) => plan.code !== summary.account?.planCode) ?? [];
  const requiresPaymentAttention = Boolean(
    currentAccessStatus === 'GRACE_PERIOD' ||
    currentAccessStatus === 'RESTRICTED' ||
    summary?.account?.status === 'PAST_DUE' ||
    summary?.account?.status === 'UNPAID' ||
    summary?.account?.status === 'INCOMPLETE',
  );

  useEffect(() => {
    const account = summary?.account;
    if (!account) return;

    const key = `platform-billing:notice:${account.id}:${account.accessStatus}:${account.gracePeriodEndsAt ?? account.canceledAt ?? ''}`;
    if (typeof window === 'undefined' || window.sessionStorage.getItem(key)) return;

    if (account.accessStatus === 'GRACE_PERIOD') {
      window.sessionStorage.setItem(key, '1');
      setNoticeDialog({
        title: 'Pagamento pendente',
        description: `A conta está em regularização até ${formatDate(account.gracePeriodEndsAt)}. Atualize o pagamento para evitar restrições.`,
        actionLabel: 'Regularizar pagamento',
        action: 'portal',
      });
    }

    if (account.accessStatus === 'RESTRICTED') {
      window.sessionStorage.setItem(key, '1');
      setNoticeDialog({
        title: 'Conta restrita',
        description: 'Algumas ações estão bloqueadas até a regularização da assinatura. O suporte continua disponível.',
        tone: 'destructive',
        actionLabel: 'Regularizar pagamento',
        action: 'portal',
      });
    }
  }, [summary?.account]);

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
      const payload = (await response.json()) as { checkoutUrl?: string; message?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.message ?? payload.error ?? 'Não foi possível abrir o pagamento.');
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

  async function openPortal() {
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
      title: type === 'upgrade' ? `Confirmar upgrade para ${targetName}` : `Agendar downgrade para ${targetName}`,
      description: type === 'upgrade'
        ? 'A diferença do plano poderá ser cobrada agora. A mudança será aplicada após a confirmação do pagamento.'
        : `O downgrade será aplicado no próximo ciclo, se a conta continuar dentro do limite de ${targetPlan?.maxActiveStudents ?? 'alunos'} alunos ativos.`,
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
        title: 'Solicitação registrada',
        description: payload.message ?? 'A alteração será aplicada após a confirmação do pagamento.',
      });
      await loadSummary();
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
        title: action === 'undo_cancel' ? 'Cancelamento revertido' : 'Cancelamento agendado',
        description: action === 'undo_cancel'
          ? 'A assinatura continuará ativa.'
          : 'A conta mantém acesso até o fim do período atual.',
      });
      await loadSummary();
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
    <div className="space-y-7">
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

      {pendingChange ? (
        <InfoCallout variant="brand" size="sm" showIcon>
          {getPlanChangeLabel(pendingChange)} {pendingChange.effectiveAt ? `em ${formatDate(pendingChange.effectiveAt)}` : 'aguarda confirmação'}.
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
              disabled={!summary.canManage || actionLoading !== null || (!requiresPaymentAttention && (Boolean(pendingChange) || availablePlanChanges.length === 0))}
              className="h-[34px] rounded-[5px] bg-[#512a82] px-5 text-sm font-medium text-[#f9f4fe] shadow-none hover:bg-[#43236c]"
            >
              {requiresPaymentAttention ? 'Regularizar pagamento' : hasActiveSubscription ? 'Fazer upgrade' : 'Escolher plano'}
            </Button>
            {summary.account?.cancelAtPeriodEnd ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingCancellationAction('undo_cancel')}
                disabled={!summary.canManage || actionLoading !== null}
                className="h-[34px] rounded-[5px] border-[#cf322a] px-4 text-sm font-medium text-[#9b231d] shadow-none hover:bg-red-50 hover:text-[#9b231d] alusa-dark:border-red-400/60 alusa-dark:bg-transparent alusa-dark:text-red-200 alusa-dark:hover:bg-red-500/10"
              >
                Reverter cancelamento
              </Button>
            ) : hasActiveSubscription && summary.account?.id && summary.account.status !== 'CANCELED' ? (
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
            Informações de faturamento
          </h3>
          <div className="mt-8 space-y-1 text-sm">
            <p className="font-medium text-[#26222d] alusa-dark:text-[color:var(--color-text-primary)]">
              {summary.billingInfo.contaName}
            </p>
            <p className="text-xs text-[#747474] alusa-dark:text-[color:var(--color-text-secondary)]">
              {summary.billingInfo.email ?? 'E-mail não informado'}
            </p>
            {summary.account?.cancelAtPeriodEnd ? (
              <p className="text-amber-700 alusa-dark:text-amber-300">
                Cancelamento agendado para {formatDate(summary.account.currentPeriodEnd)}.
              </p>
            ) : null}
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
        actionLoading={actionLoading}
        pendingChange={Boolean(pendingChange)}
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
        confirmText={pendingPlanAction?.type === 'downgrade' ? 'Agendar downgrade' : 'Confirmar upgrade'}
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
        title={pendingCancellationAction === 'undo_cancel' ? 'Reverter cancelamento?' : 'Cancelar assinatura ao fim do período?'}
        description={pendingCancellationAction === 'undo_cancel'
          ? 'A assinatura continuará ativa e a próxima cobrança seguirá conforme o ciclo atual.'
          : 'A conta mantém acesso até o fim do período atual. Nenhum dado educacional será apagado.'}
        confirmText={pendingCancellationAction === 'undo_cancel' ? 'Reverter cancelamento' : 'Agendar cancelamento'}
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
      render: (invoice) => formatDate(invoice.paidAt ?? invoice.periodEnd ?? invoice.periodStart),
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
        <Badge variant={getInvoiceBadgeVariant(invoice.status)} size="sm">
          {getInvoiceStatusLabel(invoice.status)}
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
  actionLoading,
  pendingChange,
  onPlanChange,
  onOpenPortal,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  summary: BillingSummary;
  actionLoading: string | null;
  pendingChange: boolean;
  onPlanChange: (_planCode: PublicPlan['code']) => void;
  onOpenPortal: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(860px,calc(100vh-48px))] w-[calc(100vw-56px)] max-w-none overflow-y-auto rounded-3xl border-[#d1d1d1] bg-white px-6 py-12 shadow-2xl alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] sm:px-10 md:px-16 lg:px-24 xl:px-32">
        <DialogHeader className="items-center space-y-4 text-center">
          <div className="mx-auto space-y-2 text-center">
            <DialogTitle className="text-[30px] font-medium leading-none text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-primary)] md:text-[36px]">
              Escolha seu plano
            </DialogTitle>
            <p className="mx-auto max-w-[560px] text-center text-sm leading-5 text-[#747474] alusa-dark:text-[color:var(--color-text-secondary)]">
              Selecione a capacidade ideal para sua escola. Você pode mudar de plano conforme sua base de alunos cresce.
            </p>
          </div>
          <div className="grid h-[38px] w-[169px] grid-cols-2 rounded-[7px] bg-[#f3f3f3] p-1 text-sm font-medium text-[#3d3a3f] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
            <button
              type="button"
              className="rounded-[7px] bg-white text-xs shadow-sm alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)]"
            >
              Mensal
            </button>
            <button type="button" className="rounded-[7px] text-xs" disabled>
              Anual
            </button>
          </div>
        </DialogHeader>

        <div className="mt-7 space-y-6">
          <div className="mx-auto grid w-full max-w-[1074px] gap-4 lg:grid-cols-3 xl:gap-[15px]">
            {summary.plans.map((plan) => {
              const current = summary.account?.planCode === plan.code;
              const exceeds = summary.activeStudents > plan.maxActiveStudents;
              const disabled = !summary.canManage || current || exceeds || actionLoading !== null || pendingChange;
              const theme = getPlanCardTheme(plan.code);
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
                <div
                  key={plan.code}
                  className={cn(
                    'flex min-h-[412px] flex-col rounded-[24px] p-[7px] pt-0 text-[#3d3a3f]',
                    theme.shell,
                    current && 'ring-2 ring-[#512a82]/35',
                  )}
                >
                  <div className="flex h-[55px] items-center justify-between gap-4 px-5 text-[#3d3a3f]">
                    <div className="flex items-center gap-2">
                      <h4 className="text-2xl font-medium">{displayName}</h4>
                      {current ? <Badge variant="success">Atual</Badge> : null}
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-lg font-medium">
                      {formatMoney(plan.amountCents, plan.currency)}
                      <span className="text-sm">/mês</span>
                    </p>
                  </div>

                  <div className="flex flex-1 flex-col justify-between rounded-[21px] bg-white px-[26px] py-7 alusa-dark:bg-[color:var(--color-bg-card)]">
                    <div>
                      <h5 className="text-xl font-medium text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-primary)]">
                        Até {plan.maxActiveStudents} alunos
                      </h5>
                      <p className="mt-2 min-h-10 max-w-[250px] text-sm leading-5 text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-secondary)]">
                        {getPlanDescription(plan.code)}
                      </p>
                      <ul className="mt-7 space-y-2.5">
                        {benefits.slice(0, 5).map((benefit) => (
                          <li key={benefit} className="flex items-start gap-2 text-xs leading-4 text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-secondary)]">
                            <span className="mt-0.5 flex size-[15px] shrink-0 items-center justify-center rounded-full border border-current text-[10px] leading-none">
                              ✓
                            </span>
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {exceeds ? (
                      <p className="mt-5 text-xs text-red-700 alusa-dark:text-red-300">
                        A conta possui {summary.activeStudents} alunos ativos.
                      </p>
                    ) : null}

                    <Button
                      type="button"
                      disabled={disabled}
                      onClick={() => onPlanChange(plan.code)}
                      className={cn(
                        'mt-8 h-[45px] w-full rounded-full px-6 text-base font-medium shadow-none hover:opacity-90 disabled:opacity-60',
                        theme.button,
                      )}
                    >
                      {current ? 'Plano atual' : actionLoading?.endsWith(`:${plan.code}`) ? 'Processando...' : `Torna-se ${displayName}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-5 pt-0 text-center">
            <p className="text-sm font-medium text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-secondary)]">
              <span className="text-[#1e1c1f] alusa-dark:text-[color:var(--color-text-primary)]">Sua escola precisa de mais capacidade?</span>{' '}
              <button type="button" className="underline underline-offset-2" onClick={onOpenPortal}>
                Solicite um plano personalizado.
              </button>
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={onOpenPortal}
              disabled={!summary.account?.id || actionLoading !== null || !summary.canManage}
              className="self-center border-gray-200 text-gray-500 shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-transparent alusa-dark:text-[color:var(--color-text-secondary)]"
            >
              Gerenciar pagamento
            </Button>
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

function getPlanCardTheme(code: PublicPlan['code']) {
  if (code === 'STARTER') {
    return {
      shell: 'bg-[#e7e5ea]',
      button: 'bg-[#3d3a3f] text-[#f3f3f3]',
    };
  }
  if (code === 'PREMIUM') {
    return {
      shell: 'bg-[#e2d1f8]',
      button: 'bg-[#40384a] text-[#e2d1f8]',
    };
  }
  return {
    shell: 'bg-[#e7e5ea]',
    button: 'bg-[#3d3a3f] text-[#f3f3f3]',
  };
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
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

function getRenewalLabel(account: BillingAccount | null) {
  if (!account) return 'Assinatura ainda não iniciada.';
  const date = formatLongDate(account.currentPeriodEnd);
  if (account.cancelAtPeriodEnd && date) return `Sua assinatura será encerrada em ${date}.`;
  if (account.status === 'CANCELED') return 'Assinatura cancelada.';
  if (date) return `Seu plano será renovado automaticamente em ${date}.`;
  return getBillingStatusLabel(account.status);
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

function getPlanChangeLabel(change: BillingSummary['planChanges'][number]) {
  if (change.type === 'UPGRADE') return `Upgrade para ${change.toPlanCode ? planName(change.toPlanCode) : 'novo plano'}`;
  if (change.type === 'DOWNGRADE') return `Downgrade para ${change.toPlanCode ? planName(change.toPlanCode) : 'novo plano'}`;
  if (change.type === 'CANCEL_AT_PERIOD_END') return 'Cancelamento agendado';
  return 'Alteração pendente';
}

function getInvoiceStatusLabel(status: BillingInvoice['status']) {
  switch (status) {
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

function getInvoiceBadgeVariant(status: BillingInvoice['status']): BadgeVariant {
  switch (status) {
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
