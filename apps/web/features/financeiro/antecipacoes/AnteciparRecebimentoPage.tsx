'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { pushToast } from '@/components/ui/toast';
import { ChevronRight, CreditCard, DollarSign, Search } from '@/components/icons/icons';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';
import { cn } from '@/lib/utils';
import { InfoCallout } from '@/components/ui/info-callout';
import { Eye } from 'lucide-react';
import type {
  AnticipationCandidate,
  AnticipationLimits,
  AnticipationSimulation,
  ListAnticipationCandidatesResponse,
} from './types';
import {
  formatBillingType,
  formatCurrency,
  formatDate,
  getReceivableStatusPresentation,
  sourceLabel,
} from './utils';

const PAGE_SIZE = 50;
const CANDIDATE_TABLE_GRID = 'grid-cols-[36px_minmax(320px,1.9fr)_180px_170px_120px]';
const CANDIDATE_TABLE_GUTTER = 'gap-x-3 px-4 md:px-5';

function normalizeCandidateText(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value.replace(/\[NEEDS_REVIEW\]/gi, '').trim();
  if (!normalized || /^needs_review$/i.test(normalized) || /sem vínculo local/i.test(normalized)) {
    return null;
  }

  return normalized;
}

/** Nome do pagador para exibição em lista/tabela (sem a descrição longa do plano). */
function getCandidateClientName(candidate: AnticipationCandidate): string {
  const hasLocalLink = Boolean(candidate.localId);
  const normalizedPayerName = normalizeCandidateText(candidate.payerName);
  return normalizedPayerName ?? (hasLocalLink ? 'Pagador não identificado' : 'Disponível apenas no Asaas');
}

function LimitCard({
  title,
  total,
  available,
}: {
  title: string;
  total: number;
  available: number;
}) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (available / total) * 100)) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{title}</p>
        <span className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">{percentage.toFixed(0)}% livre</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
        <div className="h-full rounded-full bg-brand-accent" style={{ width: `${percentage}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
        <span>Disponível {formatCurrency(available)}</span>
        <span>Total {formatCurrency(total)}</span>
      </div>
    </div>
  );
}

function CandidateDesktopRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: AnticipationCandidate;
  checked: boolean;
  onToggle: (_candidate: AnticipationCandidate, _checked: boolean) => void;
}) {
  const clientName = getCandidateClientName(candidate);
  const candidateIdentifier = candidate.payment ?? candidate.installment ?? candidate.id;

  return (
    <div
      className={cn(
        'hidden min-w-[858px] items-center py-4 transition lg:grid',
        CANDIDATE_TABLE_GUTTER,
        CANDIDATE_TABLE_GRID,
        checked
          ? 'bg-[#f7f2ff] shadow-[inset_2px_0_0_#8b5cf6] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:shadow-[inset_2px_0_0_var(--color-sidebar-accent)]'
          : 'bg-white hover:bg-slate-50 alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-[color:var(--color-nav-hover-bg)]',
      )}
    >
      <div className="flex items-center justify-start">
        <Checkbox
          checked={checked}
          aria-label={`Selecionar recebível · ${clientName}`}
          className="shrink-0 border-slate-300"
          onCheckedChange={(value) => onToggle(candidate, value)}
        />
      </div>

      <div className="min-w-0 pr-2">
        <p className="truncate text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{clientName}</p>

        <p className="mt-1.5 truncate text-xs leading-5 text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">ID {candidateIdentifier}</p>
      </div>

      <div>
        <p className="text-sm text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">{formatBillingType(candidate.billingType)}</p>
      </div>

      <div>
        <p className="text-sm text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">{formatDate(candidate.dueDate)}</p>
      </div>

      <div className="justify-self-end text-right">
        <p className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{formatCurrency(candidate.value)}</p>
      </div>
    </div>
  );
}

function CandidateMobileRow({
  candidate,
  checked,
  onToggle,
  onPreview,
}: {
  candidate: AnticipationCandidate;
  checked: boolean;
  onToggle: (_candidate: AnticipationCandidate, _checked: boolean) => void;
  onPreview: (_candidate: AnticipationCandidate) => void;
}) {
  const clientName = getCandidateClientName(candidate);
  const candidateIdentifier = candidate.payment ?? candidate.installment ?? candidate.id;
  const { variant, label } = getReceivableStatusPresentation(candidate.status);

  return (
    <li
      className={cn(
        'flex items-stretch gap-3 px-4 py-4 md:px-5',
        checked
          ? 'bg-[#f7f2ff] shadow-[inset_2px_0_0_#8b5cf6] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:shadow-[inset_2px_0_0_var(--color-sidebar-accent)]'
          : 'bg-white alusa-dark:bg-[color:var(--color-bg-card)]',
      )}
    >
      <div className="flex shrink-0 items-start pt-0.5">
        <Checkbox
          checked={checked}
          aria-label={`Selecionar recebível · ${clientName}`}
          className="shrink-0 border-slate-300"
          onCheckedChange={(value) => onToggle(candidate, value)}
        />
      </div>

      <div className="m-0 min-w-0 flex-1 space-y-1 p-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold leading-snug text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{clientName}</span>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
            {formatCurrency(candidate.value)}
          </span>
        </div>
        <div className="break-all text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">ID {candidateIdentifier}</div>
        <div className="text-[12px] font-medium text-slate-800 alusa-dark:text-[color:var(--color-text-secondary)]">{formatBillingType(candidate.billingType)}</div>
        <div className="text-[12px] tabular-nums text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">Venc. {formatDate(candidate.dueDate)}</div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between self-stretch">
        <button
          type="button"
          className="-mr-1 -mt-0.5 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#753CB8] focus-visible:ring-offset-1 alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:hover:bg-[color:var(--color-bg-card-soft)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
          aria-label="Ver detalhes do recebível"
          onClick={() => onPreview(candidate)}
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        </button>
        <Badge
          variant={variant}
          className="max-w-[10.5rem] whitespace-normal text-right text-[10px] leading-tight sm:text-xs"
        >
          {label}
        </Badge>
      </div>
    </li>
  );
}

function CandidatePreviewBody({ candidate }: { candidate: AnticipationCandidate }) {
  const status = getReceivableStatusPresentation(candidate.status);

  return (
    <div className="grid gap-3 text-sm">
      <div>
        <p className="text-xs font-medium text-slate-500">Recebível</p>
        <p className="font-medium text-slate-900">
          {normalizeCandidateText(candidate.description)
            ?? (candidate.localId ? sourceLabel(candidate.source) : 'Recebível sem vínculo local')}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">Pagador</p>
        <p className="text-slate-800">
          {normalizeCandidateText(candidate.payerName)
            ?? (candidate.localId ? 'Pagador não identificado' : 'Disponível apenas no Asaas')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Valor</p>
          <p className="font-semibold tabular-nums text-slate-900">{formatCurrency(candidate.value)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Forma</p>
          <p className="text-slate-800">{formatBillingType(candidate.billingType)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Vencimento</p>
          <p className="tabular-nums text-slate-800">{formatDate(candidate.dueDate)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Crédito previsto</p>
          <p className="tabular-nums text-slate-800">{formatDate(candidate.estimatedCreditDate)}</p>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">ID</p>
        <p className="break-all font-mono text-xs text-slate-800">
          {candidate.payment ?? candidate.installment ?? candidate.id}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">Status da cobrança</p>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {candidate.netValue != null ? (
        <div>
          <p className="text-xs font-medium text-slate-500">Líquido estimado (lista)</p>
          <p className="font-semibold tabular-nums text-emerald-700">{formatCurrency(candidate.netValue)}</p>
        </div>
      ) : null}
      {candidate.invoiceUrl ? (
        <div>
          <p className="text-xs font-medium text-slate-500">Documento</p>
          <a
            href={candidate.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[#753CB8] underline underline-offset-2 hover:text-[#5c2e93]"
          >
            Abrir no Asaas
          </a>
        </div>
      ) : null}
    </div>
  );
}

function SummaryPanel({
  selected,
  selectedCount,
  selectedValue,
  selectedNetValue,
  simulation,
  simulating,
  submitting,
  documentFile,
  onDocumentFile,
  onRequest,
}: {
  selected: AnticipationCandidate | null;
  selectedCount: number;
  selectedValue: number;
  selectedNetValue: number | null;
  simulation: AnticipationSimulation | null;
  simulating: boolean;
  submitting: boolean;
  documentFile: File | null;
  onDocumentFile: (_file: File | null) => void;
  onRequest: () => void;
}) {
  const singleSelection = selectedCount === 1;
  const feeValue =
    singleSelection && simulation
      ? simulation.fee
      : selectedNetValue != null
        ? Number(Math.max(0, selectedValue - selectedNetValue).toFixed(2))
        : null;
  const canSubmit = Boolean(singleSelection && selected && simulation && !simulating && !submitting);

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f4ecfd] text-[#2b2634] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-brand-300)]">
          <DollarSign className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Resumo</h2>
          <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Valores oficiais da simulação</p>
        </div>
      </div>

      <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 alusa-dark:border-[color:var(--color-border-subtle)]">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Total selecionado</span>
          <span className="font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{formatCurrency(singleSelection ? (simulation?.value ?? selectedValue) : selectedValue)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Taxa</span>
          <span className="font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{feeValue == null ? '-' : formatCurrency(feeValue)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Valor a receber</span>
          <span className="font-semibold text-emerald-700">
            {singleSelection
              ? formatCurrency(simulation?.netValue ?? selectedNetValue ?? 0)
              : selectedNetValue == null
                ? '-'
                : formatCurrency(selectedNetValue)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Data prevista</span>
          <span className="font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{singleSelection ? formatDate(simulation?.anticipationDate ?? null) : '-'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Dias antecipados</span>
          <span className="font-medium text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{singleSelection ? (simulation?.anticipationDays ?? '-') : '-'}</span>
        </div>
      </div>

      {selectedCount > 1 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
          A seleção em massa serve para conferência da lista. Para solicitar a antecipação, deixe apenas um recebível marcado.
        </div>
      ) : null}

      {singleSelection && simulation?.isDocumentationRequired ? (
        <InfoCallout variant="warning" showIcon={false} className="mt-5">
          <p className="text-sm font-medium">Documento obrigatório</p>
          <p className="mt-1 text-xs leading-5 opacity-90">
            O Asaas exige nota fiscal ou contrato para analisar esta solicitação.
          </p>
          <Input
            type="file"
            className="mt-3 h-10 rounded-lg bg-white"
            onChange={(event) => onDocumentFile(event.target.files?.[0] ?? null)}
          />
          {documentFile ? <p className="mt-2 text-xs opacity-90">{documentFile.name}</p> : null}
        </InfoCallout>
      ) : null}

      <Button
        className="mt-5 h-10 w-full rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
        disabled={!canSubmit || (simulation?.isDocumentationRequired && !documentFile)}
        onClick={onRequest}
      >
        {submitting ? 'Solicitando...' : simulating ? 'Simulando...' : 'Solicitar antecipação'}
      </Button>

      <p className="mt-3 text-center text-xs leading-5 text-slate-500">
        Sujeito a análise de crédito pelo Asaas.
      </p>
    </aside>
  );
}

export function AnteciparRecebimentoPage() {
  const [candidates, setCandidates] = useState<ListAnticipationCandidatesResponse | null>(null);
  const [limits, setLimits] = useState<AnticipationLimits | null>(null);
  const [billingType, setBillingType] = useState<'ALL' | 'CREDIT_CARD' | 'BOLETO' | 'PIX'>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<AnticipationSimulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<AnticipationCandidate | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE), billingType });
      if (search.trim()) params.set('search', search.trim());

      const [candidatesResponse, limitsResponse] = await Promise.all([
        fetch(`/api/financeiro/antecipacoes/candidatos?${params.toString()}`, { cache: 'no-store' }),
        fetch('/api/financeiro/antecipacoes/limites', { cache: 'no-store' }),
      ]);

      if (!candidatesResponse.ok) throw new Error('Falha ao carregar recebíveis');
      setCandidates(await candidatesResponse.json());

      if (limitsResponse.ok) {
        const payload = await limitsResponse.json();
        setLimits(payload.data ?? null);
      }
    } catch (error) {
      pushToast({
        title: 'Não foi possível carregar recebíveis',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [billingType, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useFinanceLiveRefresh(() => load(true), {
    enabled: !loading && !submitting && !simulating,
    intervalMs: 60_000,
    minIntervalMs: 10_000,
    realtime: { dashboard: true, portal: false },
  });

  const candidateItems = candidates?.items ?? [];

  const selectedItems = useMemo(
    () => candidateItems.filter((candidate) => selectedIds.includes(candidate.id)),
    [candidateItems, selectedIds],
  );

  const selectedCandidate = selectedItems.length === 1 ? selectedItems[0] : null;

  const selectedPayload = useMemo(() => {
    if (!selectedCandidate) return null;
    return {
      targetType: selectedCandidate.targetType,
      payment: selectedCandidate.payment ?? undefined,
      installment: selectedCandidate.installment ?? undefined,
    };
  }, [selectedCandidate]);

  const selectedValue = useMemo(
    () => Number(selectedItems.reduce((total, item) => total + item.value, 0).toFixed(2)),
    [selectedItems],
  );

  const selectedNetValue = useMemo(() => {
    if (!selectedItems.length || selectedItems.some((item) => item.netValue == null)) return null;
    return Number(selectedItems.reduce((total, item) => total + (item.netValue ?? 0), 0).toFixed(2));
  }, [selectedItems]);

  const allVisibleSelected = candidateItems.length > 0 && candidateItems.every((candidate) => selectedIds.includes(candidate.id));

  function resetSelection() {
    setSelectedIds([]);
    setSimulation(null);
    setDocumentFile(null);
    setSimulating(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function runSimulation(candidate: AnticipationCandidate) {
      setSimulation(null);
      setDocumentFile(null);
      setSimulating(true);
      try {
        const response = await fetch('/api/financeiro/antecipacoes/simular', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: candidate.targetType,
            payment: candidate.payment ?? undefined,
            installment: candidate.installment ?? undefined,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error === 'ERRO_ASAAS' ? 'O Asaas recusou a simulação para este recebível.' : 'Falha ao simular');
        }
        if (!cancelled) setSimulation(payload.data);
      } catch (error) {
        if (!cancelled) {
          pushToast({
            title: 'Simulação indisponível',
            description: error instanceof Error ? error.message : 'Escolha outro recebível.',
            variant: 'warning',
          });
        }
      } finally {
        if (!cancelled) setSimulating(false);
      }
    }

    if (!selectedCandidate) {
      setSimulation(null);
      setDocumentFile(null);
      setSimulating(false);
      return () => {
        cancelled = true;
      };
    }

    void runSimulation(selectedCandidate);

    return () => {
      cancelled = true;
    };
  }, [selectedCandidate]);

  function handleCandidateSelection(candidate: AnticipationCandidate, checked: boolean) {
    setDocumentFile(null);
    setSimulation(null);
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(candidate.id) ? current : [...current, candidate.id];
      }
      return current.filter((id) => id !== candidate.id);
    });
  }

  function handleToggleAllCandidates(checked: boolean) {
    setDocumentFile(null);
    setSimulation(null);
    setSelectedIds(checked ? candidateItems.map((candidate) => candidate.id) : []);
  }

  async function handleRequest() {
    if (!selectedPayload) return;
    if (simulation?.isDocumentationRequired && !documentFile) {
      pushToast({
        title: 'Documento obrigatório',
        description: 'Anexe a nota fiscal ou contrato para enviar a solicitação.',
        variant: 'warning',
      });
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set('targetType', selectedPayload.targetType);
      if (selectedPayload.payment) body.set('payment', selectedPayload.payment);
      if (selectedPayload.installment) body.set('installment', selectedPayload.installment);
      if (documentFile) body.set('document', documentFile);

      const response = await fetch('/api/financeiro/antecipacoes/solicitar', {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error === 'ERRO_ASAAS' ? 'Solicitação rejeitada pelo Asaas.' : 'Falha ao solicitar');
      }

      pushToast({ title: 'Antecipação solicitada', variant: 'success' });
      resetSelection();
      await load();
    } catch (error) {
      pushToast({
        title: 'Não foi possível solicitar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-5 md:px-6 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Antecipações</p>
            <h1 className="mt-1 text-[22px] font-semibold text-gray-900 md:text-[24px] alusa-dark:text-[color:var(--color-text-primary)]">Antecipar recebimento</h1>
            <p className="mt-1 text-[13px] leading-5 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
              Selecione um recebível elegível, simule o valor líquido e envie a solicitação para análise.
            </p>
          </div>
          <Button asChild variant="outline" className="h-10 rounded-xl border-slate-200">
            <Link href="/antecipacoes/minhas">
              Minhas antecipações
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LimitCard
          title="Limite de cartão"
          total={limits?.creditCard?.total ?? 0}
          available={limits?.creditCard?.available ?? 0}
        />
        <LimitCard
          title="Limite de boleto"
          total={limits?.bankSlip?.total ?? 0}
          available={limits?.bankSlip?.available ?? 0}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
          <div className="border-b border-slate-100 bg-gray-50 px-4 py-4 md:px-5 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card)]">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Disponível para antecipar</p>
                <p className="mt-1 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">{candidates?.total ?? 0} recebível(is) elegíveis no Asaas</p>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="relative min-w-0 w-full">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por aluno, cobrança ou ID..."
                    className="h-10 rounded-lg border-slate-200 bg-white pl-9"
                  />
                </div>
                <Select value={billingType} onValueChange={(value) => setBillingType(value as typeof billingType)}>
                  <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white">
                    <CreditCard className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Forma" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    <SelectItem value="CREDIT_CARD">Cartão</SelectItem>
                    <SelectItem value="BOLETO">Boleto</SelectItem>
                    <SelectItem value="PIX">Pix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : candidateItems.length ? (
            <>
              <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 md:px-5 lg:hidden alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={allVisibleSelected}
                    aria-label="Selecionar todos os recebíveis visíveis"
                    className="shrink-0 border-slate-300"
                    onCheckedChange={handleToggleAllCandidates}
                  />
                  <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
                    Selecionar todos visíveis
                  </span>
                </div>
              </div>

              <ul className="m-0 list-none divide-y divide-slate-100 p-0 lg:hidden" role="list">
                {candidateItems.map((candidate) => (
                  <CandidateMobileRow
                    key={candidate.id}
                    candidate={candidate}
                    checked={selectedIds.includes(candidate.id)}
                    onToggle={handleCandidateSelection}
                    onPreview={setPreviewCandidate}
                  />
                ))}
              </ul>

              <div className="hidden overflow-x-auto lg:block">
                <div className="min-w-[858px]">
                  <div
                    className={cn(
                      'grid items-center border-b border-slate-200 bg-slate-50/80 py-3 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]',
                      CANDIDATE_TABLE_GUTTER,
                      CANDIDATE_TABLE_GRID,
                    )}
                  >
                    <div className="flex items-center justify-start">
                      <Checkbox
                        checked={allVisibleSelected}
                        aria-label="Selecionar todos os recebíveis visíveis"
                        className="shrink-0 border-slate-300"
                        onCheckedChange={handleToggleAllCandidates}
                      />
                    </div>
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Recebível</span>
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Forma</span>
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">Vencimento</span>
                    <span className="justify-self-end text-right text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
                      Valor
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-subtle)]">
                    {candidateItems.map((candidate) => (
                      <CandidateDesktopRow
                        key={candidate.id}
                        candidate={candidate}
                        checked={selectedIds.includes(candidate.id)}
                        onToggle={handleCandidateSelection}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4ecfd] text-[#2b2634] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-brand-300)]">
                <DollarSign className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Nenhum recebível elegível</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
                Quando o Asaas liberar cobranças para antecipação, elas aparecerão nesta lista.
              </p>
            </div>
          )}
        </section>

        <SummaryPanel
          selected={selectedCandidate}
          selectedCount={selectedItems.length}
          selectedValue={selectedValue}
          selectedNetValue={selectedNetValue}
          simulation={simulation}
          simulating={simulating}
          submitting={submitting}
          documentFile={documentFile}
          onDocumentFile={setDocumentFile}
          onRequest={handleRequest}
        />
      </div>

      <Dialog open={previewCandidate !== null} onOpenChange={(open) => !open && setPreviewCandidate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalhes do recebível</DialogTitle>
            <DialogDescription>Informações retornadas pelo Asaas para antecipação.</DialogDescription>
          </DialogHeader>
          {previewCandidate ? (
            <CandidatePreviewBody candidate={previewCandidate} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
