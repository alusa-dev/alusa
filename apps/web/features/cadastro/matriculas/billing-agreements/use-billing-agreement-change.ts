'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BillingAgreementCommitResponse,
  BillingAgreementPreviewRequest,
  BillingAgreementPreviewResponse,
  BillingAgreementView,
} from './contracts';
import {
  commitBillingAgreementRequest,
  getBillingAgreementRequest,
  previewBillingAgreementRequest,
} from './service';

type AsyncState = 'idle' | 'loading' | 'success' | 'error';

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `billing-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useBillingAgreementChange(agreementId: string) {
  const [previewState, setPreviewState] = useState<AsyncState>('idle');
  const [commitState, setCommitState] = useState<AsyncState>('idle');
  const [agreementState, setAgreementState] = useState<AsyncState>('idle');
  const [preview, setPreview] = useState<BillingAgreementPreviewResponse | null>(null);
  const [previewedRequest, setPreviewedRequest] = useState<BillingAgreementPreviewRequest | null>(null);
  const [commitResult, setCommitResult] = useState<BillingAgreementCommitResponse | null>(null);
  const [agreement, setAgreement] = useState<BillingAgreementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const agreementAbortRef = useRef<AbortController | null>(null);
  const pollingAttemptsRef = useRef(0);

  const resetPreview = useCallback(() => {
    previewAbortRef.current?.abort();
    setPreview(null);
    setPreviewedRequest(null);
    setCommitResult(null);
    setPreviewState('idle');
    setCommitState('idle');
    setError(null);
  }, []);

  const requestPreview = useCallback(async (request: BillingAgreementPreviewRequest) => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewState('loading');
    setCommitState('idle');
    setPreview(null);
    setPreviewedRequest(null);
    setCommitResult(null);
    setError(null);

    try {
      const response = await previewBillingAgreementRequest(request, controller.signal);
      setPreview(response);
      setPreviewedRequest(request);
      setPreviewState('success');
      return response;
    } catch (requestError) {
      if ((requestError as { name?: string }).name === 'AbortError') return null;
      setPreviewState('error');
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível calcular a alteração.');
      return null;
    }
  }, []);

  const refreshAgreement = useCallback(async () => {
    if (!agreementId) return null;
    agreementAbortRef.current?.abort();
    const controller = new AbortController();
    agreementAbortRef.current = controller;
    setAgreementState('loading');
    try {
      const response = await getBillingAgreementRequest(agreementId, controller.signal);
      setAgreement(response);
      setAgreementState('success');
      return response;
    } catch (requestError) {
      if ((requestError as { name?: string }).name === 'AbortError') return null;
      setAgreementState('error');
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o acordo.');
      return null;
    }
  }, [agreementId]);

  const commit = useCallback(async () => {
    if (!preview || !previewedRequest || !preview.canCommit || preview.blockers.length > 0) {
      setError('Gere um preview válido antes de confirmar.');
      return null;
    }

    setCommitState('loading');
    setError(null);
    try {
      const response = await commitBillingAgreementRequest({
        ...previewedRequest,
        idempotencyKey: createIdempotencyKey(),
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedVersion: preview.sourceVersion,
      });
      setCommitResult(response);
      setCommitState('success');
      pollingAttemptsRef.current = 0;
      await refreshAgreement();
      return response;
    } catch (requestError) {
      setCommitState('error');
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível aplicar a alteração.');
      return null;
    }
  }, [preview, previewedRequest, refreshAgreement]);

  useEffect(() => {
    void refreshAgreement();
    return () => agreementAbortRef.current?.abort();
  }, [refreshAgreement]);

  useEffect(() => {
    const reconciliationPending =
      agreement?.reconciliationStatus === 'PENDING' ||
      agreement?.reconciliationStatus === 'RESULT_UNKNOWN';
    const operationPending =
      commitResult?.status === 'PENDING' ||
      commitResult?.status === 'PROCESSING' ||
      commitResult?.status === 'PARTIAL' ||
      (commitResult?.status === 'REQUIRES_RECONCILIATION' && reconciliationPending);
    const shouldPoll = operationPending || reconciliationPending;

    if (!shouldPoll || pollingAttemptsRef.current >= 60) return;
    const timer = window.setTimeout(async () => {
      pollingAttemptsRef.current += 1;
      await refreshAgreement();
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [agreement, commitResult, refreshAgreement]);

  return {
    previewState,
    commitState,
    agreementState,
    preview,
    commitResult,
    agreement,
    error,
    requestPreview,
    commit,
    refreshAgreement,
    resetPreview,
  };
}
