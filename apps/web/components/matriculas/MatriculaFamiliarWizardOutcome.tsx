'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { FamilyEnrollmentOutcome } from './wizard/types';

const terminalProvisionStatuses = new Set([
  'NAO_APLICAVEL',
  'PROVISIONADO',
  'FALHO',
  'RESULTADO_INCERTO',
  'CANCELADO',
]);
const terminalOperationStatuses = new Set([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'REQUIRES_RECONCILIATION',
  'CANCELLED',
]);

export function MatriculaFamiliarWizardOutcome(props: {
  initialOutcome: FamilyEnrollmentOutcome;
  onCreateAnother: () => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState(props.initialOutcome);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/matriculas/familiar/${encodeURIComponent(outcome.familyId)}/provisionamento`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as FamilyEnrollmentOutcome;
      setOutcome((current) => ({ ...current, ...payload }));
    } finally {
      setRefreshing(false);
    }
  }, [outcome.familyId]);

  useEffect(() => {
    const terminal = outcome.operationStatus
      ? terminalOperationStatuses.has(outcome.operationStatus)
      : terminalProvisionStatuses.has(outcome.billingProvisionStatus);
    if (terminal) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [outcome.billingProvisionStatus, outcome.operationStatus, refresh]);

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:p-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Matrícula familiar registrada</h2>
        <p className="mt-1 text-sm text-slate-600">
          O vínculo acadêmico e os contratos foram salvos. O financeiro é acompanhado
          separadamente até a confirmação do pagamento.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard label="Acadêmico" value={outcome.academicStatus} />
        <StatusCard label="Provisionamento" value={outcome.billingProvisionStatus} />
        <StatusCard label="Pagamento" value={outcome.paymentStatus} />
      </div>

      {outcome.financialError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {outcome.financialError}
        </div>
      )}

      <div className="space-y-2">
        {outcome.results.map((result) => (
          <div key={result.alunoId} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-slate-900">{result.alunoNome}</p>
              <span className={result.status === 'success' ? 'text-emerald-700' : 'text-red-700'}>
                {result.status === 'success' ? 'Matrícula e contrato criados' : 'Falha'}
              </span>
            </div>
            {result.errorMessage && (
              <p className="mt-1 text-sm text-red-700">{result.errorMessage}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Atualizando...' : 'Atualizar status'}
        </Button>
        <Button type="button" variant="outline" onClick={props.onCreateAnother}>
          Nova matrícula
        </Button>
        <Button type="button" onClick={props.onClose}>Fechar</Button>
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value.replaceAll('_', ' ')}</p>
    </div>
  );
}
