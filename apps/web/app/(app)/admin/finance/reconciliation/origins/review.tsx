'use client';

import { useCallback, useEffect, useState } from 'react';

type ResourceType = 'SUBSCRIPTION' | 'PAYMENT' | 'INSTALLMENT';
type Candidate = {
  subscriptionId?: string;
  paymentId?: string;
  installmentId?: string;
  relatedPaymentCount?: number;
  eventCount?: number;
  paymentCount?: number;
  samplePaymentIds?: string[];
  sampleExternalReferences?: string[];
  evidence: string[];
  eligible: boolean;
  conflict: string | null;
};
type Preview = { contaId: string; items: Candidate[]; total: number; pageSize: number; nextCursor: string | null };

function resourceId(item: Candidate) {
  return item.paymentId ?? item.installmentId ?? item.subscriptionId ?? '';
}

export function AsaasOriginReview() {
  const [resourceType, setResourceType] = useState<ResourceType>('SUBSCRIPTION');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPreview = useCallback(async (nextCursor: string | null, type: ResourceType) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: '20', resourceType: type });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(`/api/admin/finance/reconciliation/resources?${params}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Não foi possível carregar a prévia.');
      setPreview(body.data as Preview);
      setCursor(nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar a prévia.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPreview(null, resourceType); }, [loadPreview, resourceType]);

  async function classify(asaasId: string, origin: 'ALUSA' | 'EXTERNAL') {
    const key = `${resourceType}:${asaasId}`;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/finance/reconciliation/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceType, asaasId, origin, reason: reason[key] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'A classificação foi rejeitada. Atualize a prévia.');
      setNotice(body.data.changed ? 'Recurso classificado e auditado.' : 'Este recurso já possuía a mesma classificação.');
      setConfirmed((current) => ({ ...current, [key]: false }));
      await loadPreview(cursor, resourceType);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao classificar o recurso.');
    } finally {
      setLoading(false);
    }
  }

  const isPayment = resourceType === 'PAYMENT';
  return (
    <section className="space-y-4" aria-busy={loading}>
      <div className="flex gap-2" role="tablist" aria-label="Tipo de recurso Asaas">
        {(['SUBSCRIPTION', 'PAYMENT', 'INSTALLMENT'] as const).map((type) => (
          <button key={type} type="button" role="tab" aria-selected={resourceType === type}
            onClick={() => { setResourceType(type); setCursor(null); setPreview(null); }}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${resourceType === type ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
            {type === 'SUBSCRIPTION' ? 'Assinaturas' : type === 'PAYMENT' ? 'Pagamentos avulsos' : 'Parcelamentos'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate-800">{preview ? `Prévia tenant-scoped · conta ${preview.contaId}` : 'Carregando prévia…'}</p>
          <p className="text-sm text-slate-700">{preview ? `${preview.total} ${isPayment ? 'pagamento(s) avulso(s)' : resourceType === 'INSTALLMENT' ? 'parcelamento(s)' : 'assinatura(s)'} observados no histórico local` : 'Somente inbox e arquivo locais são consultados; nenhum dado é escrito nesta etapa.'}</p>
        </div>
        <button type="button" onClick={() => void loadPreview(cursor, resourceType)} disabled={loading} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
          Atualizar prévia
        </button>
      </div>
      {error ? <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
      <div className="space-y-3">
        {preview?.items.map((item) => {
          const id = resourceId(item);
          const key = `${resourceType}:${id}`;
          const hasLocalLink = item.conflict === 'LOCAL_SUBSCRIPTION_EXISTS' || item.conflict === 'LOCAL_PAYMENT_EXISTS' || item.conflict === 'LOCAL_INSTALLMENT_EXISTS';
          const classificationTarget = item.eligible ? 'EXTERNAL' : hasLocalLink ? 'ALUSA' : null;
          return (
            <article key={id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-mono text-sm text-slate-950">{isPayment ? 'Pagamento Asaas' : resourceType === 'INSTALLMENT' ? 'Parcelamento Asaas' : 'Assinatura Asaas'}: {id}</p>
                  <p className="text-sm text-slate-600">{isPayment ? `${item.eventCount ?? 0} evento(s) avulso(s) observados` : resourceType === 'INSTALLMENT' ? `${item.paymentCount ?? 0} pagamento(s) agrupados pelo ID exato do parcelamento` : `${item.relatedPaymentCount ?? 0} pagamento(s) relacionado(s) nos eventos armazenados`}</p>
                  {isPayment || resourceType === 'INSTALLMENT' ? <p className="text-xs text-slate-600">Referências externas observadas: {item.sampleExternalReferences?.length ? item.sampleExternalReferences.join(', ') : 'nenhuma informada nos eventos'}</p> : null}
                  {!isPayment ? <p className="text-xs text-slate-600">IDs de pagamento (até 10): {item.samplePaymentIds?.length ? item.samplePaymentIds.join(', ') : 'nenhum informado nos eventos'}</p> : null}
                  <p className="text-xs text-slate-600">Evidências avaliadas: {item.evidence.map((evidence) => evidence.replaceAll('_', ' ').toLowerCase()).join('; ')}.</p>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {item.conflict === 'ALREADY_EXTERNAL' ? 'Externa confirmada' : item.conflict === 'LOCAL_SUBSCRIPTION_EXISTS' || item.conflict === 'LOCAL_PAYMENT_EXISTS' ? 'Gerenciada pela Alusa · vínculo local' : item.conflict === 'CANONICAL_ALUSA_REFERENCE' ? 'Referência canônica Alusa' : item.eligible ? 'Origem desconhecida · elegível para análise' : `Conflito · ${item.conflict ?? 'requer análise'}`}
                  </p>
                </div>
                {classificationTarget ? (
                  <div className="w-full max-w-xl space-y-3">
                    <label className="block text-sm font-medium text-slate-800" htmlFor={`reason-${key}`}>Motivo/evidência da confirmação</label>
                    <textarea id={`reason-${key}`} value={reason[key] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [key]: event.target.value }))} rows={2} maxLength={2000} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder={classificationTarget === 'EXTERNAL' ? `Ex.: ${isPayment ? 'pagamento avulso criado e administrado diretamente pela escola no Asaas.' : resourceType === 'INSTALLMENT' ? 'parcelamento criado e administrado diretamente pela escola no Asaas.' : 'assinatura criada e administrada diretamente pela escola no Asaas.'}` : 'Ex.: vínculo local revisado e confirmado no financeiro da Alusa.'} />
                    <label className="flex items-start gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={confirmed[key] ?? false} onChange={(event) => setConfirmed((current) => ({ ...current, [key]: event.target.checked }))} className="mt-1" />
                      <span>{classificationTarget === 'EXTERNAL' ? 'Confirmo manualmente que este recurso é gerenciado fora da Alusa.' : 'Confirmo que o vínculo local exibido pertence a este recurso da Alusa.'} Esta ação será registrada com meu usuário e justificativa.</span>
                    </label>
                    <button type="button" onClick={() => void classify(id, classificationTarget)} disabled={loading || !confirmed[key] || (reason[key] ?? '').trim().length < 8} className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {classificationTarget === 'EXTERNAL' ? 'Confirmar como externa' : 'Confirmar como gerenciada pela Alusa'}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {preview?.items.length === 0 ? <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">Nenhum {isPayment ? 'pagamento avulso' : resourceType === 'INSTALLMENT' ? 'parcelamento' : 'assinatura'} encontrado nesta página.</p> : null}
      <div className="flex justify-end">
        <button type="button" onClick={() => preview?.nextCursor && void loadPreview(preview.nextCursor, resourceType)} disabled={loading || !preview?.nextCursor} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
          Próxima página
        </button>
      </div>
    </section>
  );
}
