'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { MoreVertical, XCircle, Loader2 } from 'lucide-react';
import { resolveFiscalInvoiceRowActions } from '@alusa/finance/fiscal-invoice-display-client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { InvoiceStatusBadge } from '@/features/financeiro/notafiscal/components/InvoiceStatusBadge';
import type { NotaFiscalPessoaDetalheResultDTO } from '@/features/financeiro/notafiscal/dtos';
import { resolveCobrancaHref } from '@/features/financeiro/notafiscal/mappers';

type NotaItem = NotaFiscalPessoaDetalheResultDTO['data']['notas'][number];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const [dateOnly] = value.split('T');
  const [year, month, day] = dateOnly?.split('-') ?? [];
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
};

function NotaFiscalRowActions({
  nota,
  onActionComplete,
}: {
  nota: NotaItem;
  onActionComplete?: () => void | Promise<void>;
}) {
  const cobrancaHref = resolveCobrancaHref(nota);
  const [canceling, setCanceling] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const actions = useMemo(
    () =>
      resolveFiscalInvoiceRowActions({
        status: nota.status,
        pdfUrl: nota.pdfUrl,
        xmlUrl: nota.xmlUrl,
        syncPending: nota.syncPending,
      }),
    [nota.pdfUrl, nota.status, nota.syncPending, nota.xmlUrl],
  );

  async function confirmCancelNota() {
    if (canceling) return;

    setCanceling(true);
    try {
      const res = await fetch(
        `/api/cobrancas/${encodeURIComponent(nota.cobrancaId ?? nota.chargeId)}/nota-fiscal/cancelar`,
        { method: 'POST' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? 'Não foi possível cancelar a nota fiscal.');
      }

      setCancelDialogOpen(false);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Cancelamento solicitado"
          description="Acompanharemos o status da NFS-e junto à prefeitura."
          onClose={() => toast.dismiss(t)}
        />
      ));
      await onActionComplete?.();
    } catch (error) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Não foi possível cancelar"
          description={error instanceof Error ? error.message : 'Tente novamente.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="flex justify-center" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-gray-400 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
            aria-label="Ações da nota fiscal"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={cobrancaHref}>
              <ArrowTopRightOnSquareIcon className="mr-2 h-4 w-4" />
              Ver cobrança
            </Link>
          </DropdownMenuItem>

          {actions.canViewNota && actions.notaUrl ? (
            <DropdownMenuItem asChild>
              <a href={actions.notaUrl} target="_blank" rel="noreferrer">
                <DocumentTextIcon className="mr-2 h-4 w-4" />
                Baixar nota
              </a>
            </DropdownMenuItem>
          ) : null}

          {actions.canEdit ? (
            <DropdownMenuItem asChild>
              <Link href={`${cobrancaHref}#nota-fiscal`}>
                <PencilSquareIcon className="mr-2 h-4 w-4" />
                Editar nota
              </Link>
            </DropdownMenuItem>
          ) : null}

          {actions.canCancel ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={canceling}
                className="text-red-600 focus:text-red-600"
                onSelect={(event) => {
                  event.preventDefault();
                  setCancelDialogOpen(true);
                }}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar nota
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          if (!canceling) setCancelDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar nota fiscal?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação depende das regras da prefeitura e pode ficar em processamento. Deseja
              continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canceling}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={canceling}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={(event) => {
                event.preventDefault();
                void confirmCancelNota();
              }}
            >
              {canceling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Cancelando...
                </>
              ) : (
                'Sim, cancelar nota'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function resolveServiceLabel(nota: NotaItem) {
  return nota.serviceLabel || nota.cobrancaDescricao || '—';
}

function ServiceCell({ nota, className }: { nota: NotaItem; className?: string }) {
  const label = resolveServiceLabel(nota);

  return (
    <div className="min-w-0" title={label !== '—' ? label : undefined}>
      <p className={className ?? 'truncate text-sm text-gray-700'}>{label}</p>
    </div>
  );
}

type NotaFiscalTableProps = {
  notas: NotaItem[];
  showAlunoColumn?: boolean;
  hasActiveFilters?: boolean;
  totalNotas?: number;
  onActionComplete?: () => void | Promise<void>;
};

function resolveStatusHint(nota: NotaItem) {
  return [nota.syncPending ? 'Atualizando status' : null, nota.errorMessage].filter(Boolean).join(' — ') || undefined;
}

const serviceColClass = (showAlunoColumn: boolean) =>
  showAlunoColumn ? 'col-span-2 min-w-0' : 'col-span-4 min-w-0';

export function NotaFiscalTable({
  notas,
  showAlunoColumn = false,
  hasActiveFilters = false,
  totalNotas = 0,
  onActionComplete,
}: NotaFiscalTableProps) {
  if (notas.length === 0) {
    const isFilteredEmpty = hasActiveFilters && totalNotas > 0;

    return (
      <div className="px-4 py-12 text-center text-gray-500 sm:px-6">
        <div className="mb-3 text-4xl">{isFilteredEmpty ? '🔍' : '📄'}</div>
        <p className="text-sm">
          {isFilteredEmpty
            ? 'Nenhuma nota fiscal para os filtros selecionados'
            : 'Nenhuma nota fiscal registrada para este cliente'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {isFilteredEmpty
            ? 'Ajuste o status ou o período de emissão para ampliar a busca.'
            : 'As notas emitidas para este cliente aparecerão aqui.'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 divide-y divide-gray-100">
      <div className="hidden bg-gray-50 px-6 py-3 lg:block">
        <div className="grid min-w-0 grid-cols-12 items-center gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
          <div className="col-span-1 text-center">Nº</div>
          <div className="col-span-2">Emissão</div>
          <div className="col-span-2 text-center">Valor</div>
          <div className="col-span-2 text-center">Status</div>
          {showAlunoColumn ? <div className="col-span-2 min-w-0">Aluno</div> : null}
          <div className={serviceColClass(showAlunoColumn)}>Serviço</div>
          <div className="col-span-1 text-center">Ações</div>
        </div>
      </div>

      {notas.map((nota) => (
        <div key={nota.id} className="min-w-0 transition-colors hover:bg-gray-50/80">
          {/* Mobile */}
          <div className="flex min-w-0 gap-3 px-4 py-3 sm:px-5 lg:hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {nota.number ? (
                  <span className="text-xs font-medium text-gray-400">#{nota.number}</span>
                ) : null}
                <span className="text-[13px] font-medium tabular-nums text-gray-900">
                  {formatDate(nota.effectiveDate)}
                </span>
              </div>
              {showAlunoColumn && nota.alunoNome ? (
                <p className="mt-0.5 truncate text-[11px] text-gray-500">{nota.alunoNome}</p>
              ) : null}
              <div className="mt-1">
                <ServiceCell nota={nota} className="truncate text-[12px] text-gray-600" />
              </div>
              <div className="mt-2 text-[13px] font-semibold text-gray-900">
                {formatCurrency(nota.value)}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 self-start">
              <NotaFiscalRowActions nota={nota} onActionComplete={onActionComplete} />
              <div title={resolveStatusHint(nota)}>
                <InvoiceStatusBadge
                  status={nota.status}
                  className="max-w-[7.5rem] truncate px-2 text-[10px]"
                />
              </div>
            </div>
          </div>

          {/* Desktop */}
          <div className="hidden px-6 py-3 lg:block">
            <div className="grid min-w-0 grid-cols-12 items-center gap-4">
              <div className="col-span-1 min-w-0 text-center">
                <span className="text-xs font-medium text-gray-400">{nota.number ?? '—'}</span>
              </div>
              <div className="col-span-2 min-w-0">
                <div className="truncate text-sm text-gray-900">{formatDate(nota.effectiveDate)}</div>
              </div>
              <div className="col-span-2 min-w-0 text-center">
                <div className="truncate text-sm font-semibold text-gray-900">
                  {formatCurrency(nota.value)}
                </div>
              </div>
              <div className="col-span-2 flex min-w-0 justify-center" title={resolveStatusHint(nota)}>
                <InvoiceStatusBadge status={nota.status} className="max-w-full shrink truncate text-[11px]" />
              </div>
              {showAlunoColumn ? (
                <div className="col-span-2 min-w-0">
                  <div className="truncate text-sm text-gray-900">{nota.alunoNome ?? '—'}</div>
                </div>
              ) : null}
              <div className={serviceColClass(showAlunoColumn)}>
                <ServiceCell nota={nota} />
              </div>
              <div className="col-span-1 min-w-0">
                <NotaFiscalRowActions nota={nota} onActionComplete={onActionComplete} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
