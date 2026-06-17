'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, FileText, Loader2, ReceiptText, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { InfoCallout, InfoCalloutItem, InfoCalloutLink } from '@/components/ui/info-callout';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FiscalFieldLabel,
  fiscalInputClass,
} from '@/features/configuracoes/notafiscal/FiscalWizardFields';
import { cn } from '@/lib/utils';

type InvoiceData = {
  id: string;
  status: string;
  statusDescription: string | null;
  errorMessage: string | null;
  number: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  serviceDescription: string | null;
  observations: string | null;
  hasProviderInvoice: boolean;
  effectiveDate: string | null;
  scheduledAt: string | null;
  statusUpdatedAt: string;
};

type ChargeInvoiceState = {
  invoice: InvoiceData | null;
  readiness: { ready: boolean; issues: Array<{ code: string; message: string }> };
  municipalOptions: { supportsCancellation: boolean | null };
  eligibility: {
    canEmit: boolean;
    canRetry: boolean;
    canCancel: boolean;
    shouldAutoCancel: boolean;
    reason: string;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'danger';
  };
  preview?: ChargeInvoicePreview;
  syncPending?: boolean;
};

type EmitFormState = {
  serviceDescription: string;
  observations: string;
  deductions: number;
  effectiveDate: string;
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendada',
  SYNCHRONIZED: 'Enviada à prefeitura',
  AUTHORIZED: 'Emitida',
  PROCESSING_CANCELLATION: 'Cancelamento em processamento',
  CANCELED: 'Cancelada',
  CANCELLATION_DENIED: 'Cancelamento negado',
  ERROR: 'Erro na emissão',
};

const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  SCHEDULED: 'info',
  SYNCHRONIZED: 'info',
  AUTHORIZED: 'success',
  PROCESSING_CANCELLATION: 'warning',
  CANCELED: 'neutral',
  CANCELLATION_DENIED: 'warning',
  ERROR: 'destructive',
};

const EMPTY_FORM: EmitFormState = {
  serviceDescription: '',
  observations: '',
  deductions: 0,
  effectiveDate: '',
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function previewToForm(preview: ChargeInvoicePreview): EmitFormState {
  return {
    serviceDescription: preview.serviceDescription,
    observations: preview.observations,
    deductions: preview.deductions,
    effectiveDate: preview.effectiveDate,
  };
}

type CobrancaNotaFiscalProps = {
  /** Id da cobrança acadêmica ou id da charge (rota /cobrancas/[id]). */
  cobrancaId: string;
  sectionClassName?: string;
};

const LOAD_ERROR_MESSAGES: Record<string, string> = {
  CHARGE_NAO_ENCONTRADA: 'Cobrança não encontrada para emitir nota fiscal.',
  CHARGE_NAO_ENCONTRADO: 'Cobrança não encontrada para emitir nota fiscal.',
  NAO_AUTENTICADO: 'Sessão expirada. Faça login novamente.',
  SEM_PERMISSAO: 'Seu perfil não tem permissão para emitir notas fiscais.',
};

const TERMINAL_INVOICE_STATUSES = new Set(['AUTHORIZED', 'ERROR', 'CANCELED', 'CANCELLATION_DENIED']);
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_MS = 5 * 60 * 1000;

const fieldLabelClass = 'text-xs font-medium text-slate-600';
const readOnlyFieldClass =
  'w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-700 cursor-not-allowed rounded-md';

type ChargeInvoicePreview = {
  serviceDescription: string;
  observations: string;
  deductions: number;
  effectiveDate: string;
  minEffectiveDate: string;
  value: number;
  municipalServiceName: string;
  municipalServiceCode: string | null;
};

function isInvoiceAwaitingSync(
  invoice: InvoiceData | null | undefined,
  minEffectiveDate?: string,
): boolean {
  if (!invoice?.hasProviderInvoice) return false;
  if (invoice.status === 'PROCESSING_CANCELLATION') return true;
  if (TERMINAL_INVOICE_STATUSES.has(invoice.status)) return false;
  if (invoice.status === 'SYNCHRONIZED') return true;
  if (invoice.status === 'SCHEDULED') {
    if (!invoice.effectiveDate || !minEffectiveDate) return true;
    return invoice.effectiveDate <= minEffectiveDate;
  }
  return false;
}

function syncStatusMessage(status: string | undefined): string {
  if (status === 'PROCESSING_CANCELLATION') {
    return 'Aguardando confirmação de cancelamento da prefeitura…';
  }
  if (status === 'SYNCHRONIZED') {
    return 'Aguardando autorização da prefeitura…';
  }
  return 'Processando emissão da NFS-e…';
}

function formatDisplayServiceDescription(
  description: string | null | undefined,
  fallback?: string | null,
): string | null {
  const trimmed = description?.trim();
  if (!trimmed) return fallback?.trim() || null;

  const normalized = trimmed
    .replace(/\s*[—–-]\s*[—–-]+\s*/g, ' — ')
    .replace(/\s*[—–-]\s*(competência|competencia)\s*$/i, '')
    .replace(/\s*(competência|competencia)\s*$/i, '')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!normalized || normalized === 'Serviços educacionais') {
    return fallback?.trim() || normalized || null;
  }

  return normalized;
}

function InvoiceStatusBadge({
  status,
  awaitingSync,
}: {
  status: string;
  awaitingSync?: boolean;
}) {
  const label = STATUS_LABELS[status] ?? status;
  const variant = STATUS_BADGE_VARIANT[status] ?? 'neutral';

  if (awaitingSync && (status === 'SCHEDULED' || status === 'SYNCHRONIZED' || status === 'PROCESSING_CANCELLATION')) {
    return (
      <Badge variant={status === 'PROCESSING_CANCELLATION' ? 'warning' : 'info'} size="sm" className="gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  );
}

export function CobrancaNotaFiscal({ cobrancaId, sectionClassName }: CobrancaNotaFiscalProps) {
  const [state, setState] = useState<ChargeInvoiceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emitOpen, setEmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<EmitFormState>(EMPTY_FORM);
  const pollStartedAtRef = useRef<number | null>(null);
  const successToastShownRef = useRef(false);

  const preview = state?.preview;
  const eligibility = state?.eligibility;
  const minEffectiveDate = preview?.minEffectiveDate;
  const awaitingSync =
    syncing || Boolean(state?.syncPending) || isInvoiceAwaitingSync(state?.invoice, minEffectiveDate);

  const formError = useMemo(() => {
    if (!preview) return null;
    if (!form.serviceDescription.trim()) return 'Informe a descrição dos serviços.';
    if (form.deductions > preview.value) {
      return 'As deduções não podem ser maiores que o valor da nota.';
    }
    if (form.effectiveDate && form.effectiveDate < preview.minEffectiveDate) {
      return 'A data de emissão não pode ser anterior à data atual.';
    }
    return null;
  }, [form, preview]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const res = await fetch(`/api/cobrancas/${encodeURIComponent(cobrancaId)}/nota-fiscal`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        const code = typeof json.error === 'string' ? json.error : '';
        setLoadError(LOAD_ERROR_MESSAGES[code] ?? json.message ?? 'Não foi possível carregar a nota fiscal.');
        setState(null);
        return null;
      }
      setState(json.data);
      if (json.data.preview) {
        setForm(previewToForm(json.data.preview));
      }
      return json.data as ChargeInvoiceState;
    } catch (e) {
      console.error(e);
      if (!options?.silent) {
        setLoadError('Não foi possível carregar a nota fiscal.');
        setState(null);
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [cobrancaId]);

  const syncFromProvider = useCallback(async () => {
    const res = await fetch(
      `/api/cobrancas/${encodeURIComponent(cobrancaId)}/nota-fiscal/sincronizar`,
      { method: 'POST' },
    );
    if (!res.ok) return null;
    return load({ silent: true });
  }, [cobrancaId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!awaitingSync) {
      pollStartedAtRef.current = null;
      return;
    }

    if (pollStartedAtRef.current == null) {
      pollStartedAtRef.current = Date.now();
    }

    const tick = async () => {
      const next = await syncFromProvider();
      const invoice = next?.invoice;
      if (!invoice) return;

      if (invoice.status === 'AUTHORIZED' && !successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Nota fiscal emitida"
            description={
              invoice.number
                ? `NFS-e nº ${invoice.number} disponível para download.`
                : 'A NFS-e foi autorizada pela prefeitura.'
            }
            onClose={() => toast.dismiss(t)}
          />
        ));
      }

      if (invoice.status === 'ERROR' && !successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Erro na emissão"
            description={invoice.errorMessage ?? 'Verifique os dados fiscais e tente novamente.'}
            onClose={() => toast.dismiss(t)}
          />
        ));
      }

      if (invoice.status === 'CANCELED' && !successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Nota fiscal cancelada"
            description="A NFS-e foi cancelada com sucesso."
            onClose={() => toast.dismiss(t)}
          />
        ));
      }

      if (invoice.status === 'CANCELLATION_DENIED' && !successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Cancelamento negado"
            description={invoice.statusDescription ?? 'A prefeitura não autorizou o cancelamento da NFS-e.'}
            onClose={() => toast.dismiss(t)}
          />
        ));
      }

      const stillAwaiting =
        Boolean(next.syncPending) || isInvoiceAwaitingSync(invoice, next.preview?.minEffectiveDate ?? minEffectiveDate);
      const timedOut =
        pollStartedAtRef.current != null && Date.now() - pollStartedAtRef.current > POLL_MAX_MS;

      if (!stillAwaiting || timedOut) {
        setSyncing(false);
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [awaitingSync, minEffectiveDate, syncFromProvider]);

  async function handleEmit() {
    if (formError) return;

    setSubmitting(true);
    successToastShownRef.current = false;
    try {
      const res = await fetch(`/api/cobrancas/${encodeURIComponent(cobrancaId)}/nota-fiscal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? 'Erro ao emitir nota fiscal');
      }

      setState(json.data);
      setEmitOpen(false);

      const invoice = json.data.invoice as InvoiceData | null;
      const shouldSync =
        Boolean(json.data.syncPending) || isInvoiceAwaitingSync(invoice, preview?.minEffectiveDate);

      if (invoice?.status === 'AUTHORIZED') {
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Nota fiscal emitida"
            description={
              invoice.number
                ? `NFS-e nº ${invoice.number} disponível para download.`
                : 'A NFS-e foi autorizada pela prefeitura.'
            }
            onClose={() => toast.dismiss(t)}
          />
        ));
        setSyncing(false);
        return;
      }

      if (shouldSync) {
        setSyncing(true);
        pollStartedAtRef.current = Date.now();
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Emissão iniciada"
            description="Estamos acompanhando a NFS-e. Você será avisado quando concluir."
            onClose={() => toast.dismiss(t)}
          />
        ));
        return;
      }

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Nota fiscal agendada"
          description={
            invoice?.effectiveDate
              ? `Emissão programada para ${formatDateBr(invoice.effectiveDate)}.`
              : 'A emissão foi agendada.'
          }
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível emitir"
          description={e instanceof Error ? e.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelInvoice() {
    if (!invoice || canceling) return;
    const confirmed = window.confirm(
      'Cancelar esta NFS-e? Essa ação depende das regras da prefeitura e pode ficar em processamento.',
    );
    if (!confirmed) return;

    setCanceling(true);
    try {
      const res = await fetch(
        `/api/cobrancas/${encodeURIComponent(cobrancaId)}/nota-fiscal/cancelar`,
        { method: 'POST' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? 'Não foi possível cancelar a nota fiscal.');
      }

      await load({ silent: true });
      setSyncing(true);
      pollStartedAtRef.current = Date.now();
      successToastShownRef.current = false;
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Cancelamento solicitado"
          description="Acompanharemos o status da NFS-e junto à prefeitura."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível cancelar"
          description={e instanceof Error ? e.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setCanceling(false);
    }
  }

  function formatDateBr(isoDate: string) {
    const [year, month, day] = isoDate.split('-');
    if (!year || !month || !day) return isoDate;
    return `${day}/${month}/${year}`;
  }

  const sectionClass = cn(
    sectionClassName ??
      'mx-auto w-full max-w-4xl space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4',
  );

  const invoice = state?.invoice;
  const configPending = state && !state.readiness.ready;
  const cancellationUnsupported = state?.municipalOptions.supportsCancellation === false;
  const displayDescription = formatDisplayServiceDescription(
    invoice?.serviceDescription,
    preview?.municipalServiceName,
  );

  return (
    <section className={sectionClass} data-testid="cobranca-nota-fiscal">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-slate-700">Nota Fiscal</span>
          <p className="mt-1 text-sm text-slate-600">
            Emissão fiscal vinculada a esta cobrança.
          </p>
        </div>
        {invoice ? (
          <InvoiceStatusBadge status={invoice.status} awaitingSync={awaitingSync} />
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando nota fiscal">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : null}

      {!loading && loadError ? (
        <InfoCallout variant="warning" size="sm">
          <InfoCalloutItem label="Nota fiscal indisponível" labelTone="warning">
            {loadError}
          </InfoCalloutItem>
        </InfoCallout>
      ) : null}

      {!loading && !loadError && configPending ? (
        <div className="space-y-2">
          <InfoCallout variant="warning" size="sm">
            <InfoCalloutItem label="Configuração pendente" labelTone="warning">
              Complete a configuração fiscal da escola para emitir notas.{' '}
              <InfoCalloutLink href="/admin/configuracoes/notafiscal">
                Ir para Configurações → Nota Fiscal
              </InfoCalloutLink>
            </InfoCalloutItem>
          </InfoCallout>
          {state.readiness.issues.length > 0 ? (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {state.readiness.issues.slice(0, 4).map((issue) => (
                <li key={issue.code}>- {issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!loading && !loadError && !configPending && !invoice ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <ReceiptText className="h-6 w-6 text-slate-400" aria-hidden />
          </div>
          <p className="text-sm font-medium text-slate-900">Nenhuma nota fiscal emitida</p>
          <p className="mt-1 max-w-sm text-xs text-slate-600">
            {eligibility?.message ??
              'Emita a NFS-e desta cobrança quando o pagamento estiver confirmado e a configuração fiscal estiver completa.'}
          </p>
          {eligibility?.canEmit ? (
            <Button size="sm" className="mt-4" onClick={() => setEmitOpen(true)} disabled={!preview}>
              Emitir nota fiscal
            </Button>
          ) : (
            <Button size="sm" className="mt-4" variant="outline" onClick={() => void load({ silent: true })}>
              Revalidar status
            </Button>
          )}
        </div>
      ) : null}

      {!loading && !loadError && invoice ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="nota-fiscal-numero" className={fieldLabelClass}>
                Número
              </label>
              <Input
                id="nota-fiscal-numero"
                readOnly
                value={invoice.number ? `Nº ${invoice.number}` : '—'}
                className={readOnlyFieldClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="nota-fiscal-emissao" className={fieldLabelClass}>
                Data de emissão
              </label>
              <Input
                id="nota-fiscal-emissao"
                readOnly
                value={invoice.effectiveDate ? formatDateBr(invoice.effectiveDate) : '—'}
                className={readOnlyFieldClass}
              />
            </div>
          </div>

          {displayDescription ? (
            <div className="space-y-1">
              <label htmlFor="nota-fiscal-descricao" className={fieldLabelClass}>
                Descrição dos serviços
              </label>
              <Textarea
                id="nota-fiscal-descricao"
                readOnly
                rows={2}
                value={displayDescription}
                className={cn(readOnlyFieldClass, 'min-h-[4.5rem] resize-none py-2')}
              />
            </div>
          ) : null}

          {awaitingSync ? (
            <InfoCallout variant="info" size="sm">
              <InfoCalloutItem label="Em processamento">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-accent" aria-hidden />
                  {syncStatusMessage(invoice.status)}
                </span>
              </InfoCalloutItem>
            </InfoCallout>
          ) : null}

          {invoice.status === 'ERROR' && invoice.errorMessage ? (
            <InfoCallout variant="warning" size="sm">
              <InfoCalloutItem label="Erro na emissão" labelTone="warning">
                {invoice.errorMessage}
              </InfoCalloutItem>
            </InfoCallout>
          ) : null}

          {eligibility?.message && invoice.status !== 'ERROR' ? (
            <InfoCallout
              variant={eligibility.severity === 'danger' || eligibility.severity === 'warning' ? 'warning' : 'info'}
              size="sm"
            >
              <InfoCalloutItem
                label="Regra fiscal"
                labelTone={eligibility.severity === 'danger' || eligibility.severity === 'warning' ? 'warning' : 'default'}
              >
                {eligibility.message}
              </InfoCalloutItem>
            </InfoCallout>
          ) : null}

          {invoice.status === 'SCHEDULED' &&
          invoice.effectiveDate &&
          minEffectiveDate &&
          invoice.effectiveDate > minEffectiveDate ? (
            <p className="text-xs text-slate-600">
              Emissão agendada para {formatDateBr(invoice.effectiveDate)}. A nota será emitida na data
              informada.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {invoice.pdfUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                  <FileText className="mr-1.5 h-4 w-4" aria-hidden />
                  Ver PDF
                </a>
              </Button>
            ) : null}
            {invoice.xmlUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={invoice.xmlUrl} target="_blank" rel="noreferrer">
                  <FileCode2 className="mr-1.5 h-4 w-4" aria-hidden />
                  Ver XML
                </a>
              </Button>
            ) : null}
            {invoice.status === 'SCHEDULED' && !invoice.hasProviderInvoice ? (
              <Button size="sm" onClick={() => setEmitOpen(true)} disabled={submitting || syncing || !eligibility?.canEmit}>
                Reenviar emissão
              </Button>
            ) : null}
            {invoice.status === 'ERROR' ? (
              <Button
                size="sm"
                onClick={() => setEmitOpen(true)}
                disabled={submitting || syncing || !(eligibility?.canRetry ?? eligibility?.canEmit)}
              >
                Tentar novamente
              </Button>
            ) : null}
            {eligibility?.canCancel && !cancellationUnsupported ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelInvoice}
                disabled={submitting || syncing || canceling}
              >
                {canceling ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="mr-1.5 h-4 w-4" aria-hidden />
                )}
                Cancelar NFS-e
              </Button>
            ) : null}
          </div>
          {eligibility?.canCancel && cancellationUnsupported ? (
            <p className="text-xs text-slate-600">
              A prefeitura desta conta não permite cancelamento automático pela integração. Faça o
              cancelamento no emissor e sincronize a nota em seguida.
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={emitOpen}
        onOpenChange={(open) => {
          setEmitOpen(open);
          if (open && preview) {
            setForm(previewToForm(preview));
          }
        }}
      >
        <DialogContent
          className={cn(
            'flex max-h-[min(90dvh,calc(100dvh-4rem))] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0',
            'alusa-modal-surface border-[#e5e7eb]',
          )}
        >
          <DialogHeader className="space-y-1 border-b border-[#e5e7eb] px-5 py-4 text-left">
            <DialogTitle className="text-base font-semibold text-gray-900">
              Emitir nota fiscal
            </DialogTitle>
            <p className="text-sm text-gray-600">
              Revise os dados e confirme. A Alusa acompanha a emissão automaticamente.
            </p>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <InfoCallout variant="info" size="sm">
              <InfoCalloutItem label="Campos obrigatórios">
                Descrição dos serviços, observações, valor, deduções, data de emissão e serviço
                municipal são enviados conforme exigido pelo emissor da NFS-e.
              </InfoCalloutItem>
            </InfoCallout>

            {preview ? (
              <div className="grid gap-3 rounded-lg border border-[#e5e7eb] bg-gray-50/80 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-600">Valor da nota</span>
                  <span className="font-medium text-gray-900">{formatCurrency(preview.value)}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-600">Serviço municipal</span>
                  <span className="text-right font-medium text-gray-900">
                    {preview.municipalServiceName}
                    {preview.municipalServiceCode ? (
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">
                        Código {preview.municipalServiceCode}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : null}

            <div className={FISCAL_WIZARD_FIELD_CLASS}>
              <FiscalFieldLabel
                label="Data de emissão"
                help="Data em que a NFS-e será emitida. Não pode ser anterior à data atual."
              />
              <Input
                type="date"
                min={preview?.minEffectiveDate}
                value={form.effectiveDate}
                className={fiscalInputClass(Boolean(formError?.includes('data')))}
                onChange={(e) => setForm((current) => ({ ...current, effectiveDate: e.target.value }))}
              />
            </div>

            <div className={FISCAL_WIZARD_FIELD_CLASS}>
              <FiscalFieldLabel
                label="Descrição dos serviços"
                help="Texto que aparecerá na NFS-e descrevendo o serviço prestado."
              />
              <Textarea
                rows={3}
                value={form.serviceDescription}
                className={cn(fiscalInputClass(false), 'min-h-[5.5rem] resize-none py-2')}
                onChange={(e) =>
                  setForm((current) => ({ ...current, serviceDescription: e.target.value }))
                }
              />
            </div>

            <div className={FISCAL_WIZARD_FIELD_CLASS}>
              <FiscalFieldLabel
                label="Observações"
                help="Informações complementares enviadas junto à nota fiscal."
              />
              <Textarea
                rows={2}
                value={form.observations}
                className={cn(fiscalInputClass(false), 'min-h-[4.5rem] resize-none py-2')}
                onChange={(e) => setForm((current) => ({ ...current, observations: e.target.value }))}
              />
            </div>

            <div className={FISCAL_WIZARD_FIELD_CLASS}>
              <FiscalFieldLabel
                label="Deduções (R$)"
                help="Não alteram o valor total da nota, mas reduzem a base de cálculo do ISS."
              />
              <Input
                type="number"
                min={0}
                max={preview?.value}
                step="0.01"
                value={Number.isFinite(form.deductions) ? form.deductions : 0}
                className={fiscalInputClass(Boolean(formError?.includes('deduções')))}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    deductions: e.target.value === '' ? 0 : Number(e.target.value),
                  }))
                }
              />
            </div>

            {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
          </div>

          <DialogFooter className="border-t border-[#e5e7eb] px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setEmitOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleEmit} disabled={submitting || syncing || Boolean(formError) || !eligibility?.canEmit}>
              {submitting ? 'Emitindo…' : 'Confirmar emissão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
