'use client';

import { useEffect, useRef, useState } from 'react';

import { CheckoutResumePopup } from './CheckoutResumePopup';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';

const SESSION_NOTICE_VERSION = 'v1';

export function MonthlyCloseInconclusiveNotice({ suppressed = false }: { suppressed?: boolean }) {
  const { summary, loading, userId } = usePlatformBilling();
  const tenantId = summary?.health.contaId ?? null;
  const storageKey = tenantId && userId
    ? `alusa:platform-billing:session-notice:${SESSION_NOTICE_VERSION}:monthly-close-inconclusive:${userId}`
    : null;
  const [readyStorageKey, setReadyStorageKey] = useState<string | null>(null);
  const [dismissedStorageKey, setDismissedStorageKey] = useState<string | null>(null);
  const currentUserIdRef = useRef(userId);
  const sessionChanged = currentUserIdRef.current !== userId;
  if (sessionChanged) currentUserIdRef.current = userId;

  useEffect(() => {
    if (!storageKey) {
      setReadyStorageKey(null);
      return;
    }

    let wasDismissed = false;
    try {
      wasDismissed = window.sessionStorage.getItem(storageKey) === '1';
    } catch {
      // In-memory state still prevents the notice from returning while mounted.
    }
    setDismissedStorageKey(wasDismissed ? storageKey : null);
    setReadyStorageKey(storageKey);
  }, [storageKey]);

  const hasInconclusiveMonthlyClose = summary?.issues.some(
    (issue) => issue.code === 'MONTHLY_CLOSE_INCONCLUSIVE',
  ) ?? false;
  const isVisible = Boolean(
    hasInconclusiveMonthlyClose &&
    storageKey &&
    readyStorageKey === storageKey &&
    dismissedStorageKey !== storageKey &&
    !loading &&
    !sessionChanged &&
    !suppressed,
  );

  useEffect(() => {
    if (!isVisible || !storageKey) return;
    try {
      // Mark on first display so a reload or remount cannot show it twice
      // during the same browser tab session.
      window.sessionStorage.setItem(storageKey, '1');
    } catch {
      // In-memory state still keeps it to one display while this shell is mounted.
    }
  }, [isVisible, storageKey]);

  function dismissForSession() {
    if (!storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, '1');
    } catch {
      // In-memory state still prevents the notice from returning while mounted.
    }
    setDismissedStorageKey(storageKey);
  }

  if (!isVisible) return null;

  return (
    <CheckoutResumePopup
      placement="top-right"
      autoDismissMs={null}
      loading={false}
      title="Sua mensalidade atual foi mantida"
      description="O fechamento mensal mais recente não pôde ser confirmado. Mantenha os alunos e as matrículas atualizados para que os próximos fechamentos reflitam a realidade da escola."
      actionLabel="Ver alunos"
      onDismiss={dismissForSession}
      onResume={() => {
        dismissForSession();
        window.location.assign('/students');
      }}
    />
  );
}
