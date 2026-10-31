'use client';

import React, { useState } from 'react';
import { CheckoutResumePopup } from './CheckoutResumePopup';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';

export function MonthlyCloseInconclusiveNotice({ suppressed = false }: { suppressed?: boolean }) {
  const { summary, loading } = usePlatformBilling();
  const issue = summary?.issues.find(
    (entry) => entry.code === 'MONTHLY_CLOSE_INCONCLUSIVE' && entry.ignoredAt === null,
  ) ?? null;
  const [dismissedIssueId, setDismissedIssueId] = useState<string | null>(null);
  const storageKey = issue ? `alusa:platform-billing:monthly-close-dismissed:${issue.id}` : null;
  let dismissedInSession = false;
  if (storageKey) {
    try { dismissedInSession = window.sessionStorage.getItem(storageKey) === '1'; } catch { /* keep in-memory behavior */ }
  }

  const acknowledge = async (issueId: string) => {
    try {
      await fetch('/api/platform-billing/issues/monthly-close-inconclusive/acknowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ issueId }),
      });
    } catch {
      // The billing area still shows the open occurrence if confirmation is unavailable.
    }
  };

  const isVisible = Boolean(
    issue && dismissedIssueId !== issue.id && !dismissedInSession && !loading && !suppressed,
  );
  if (!isVisible || !issue) return null;

  const competence = formatCompetence(issue.periodStart);
  const dismiss = () => {
    setDismissedIssueId(issue.id);
    try { if (storageKey) window.sessionStorage.setItem(storageKey, '1'); } catch { /* confirmation is still sent to the server */ }
    void acknowledge(issue.id);
  };

  return (
    <CheckoutResumePopup
      placement="top-right"
      autoDismissMs={null}
      loading={false}
      title={`Fechamento de ${competence} inconclusivo`}
      description={`A competência ${competence} não teve fechamento confirmado. A faixa vigente foi mantida e nenhuma alteração automática foi aplicada.`}
      actionLabel="Ver faturamento"
      onDismiss={dismiss}
      onResume={() => {
        dismiss();
        window.location.assign('/account/billing-plan');
      }}
    />
  );
}

function formatCompetence(value: string | null): string {
  if (!value) return 'mensal';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return 'mensal';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
