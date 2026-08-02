'use client';

import Link from 'next/link';

import { ExternalLink } from '@/components/icons/icons';
import { DataTable, type DataTableColumn } from '@/components/layout/DataTable';
import { Pagination } from '@/components/layout/Pagination';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type {
  DelinquencyGroupItem,
  FinancialReportDetailItem,
  FinancialReportPage,
} from '../dtos';
import {
  formatReportDate,
  formatReportMoney,
  PAYMENT_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from '../utils/formatters';

type DetailProps = {
  data: FinancialReportPage<FinancialReportDetailItem>;
  loading?: boolean;
  timeZone?: string;
  onPageChange: (_page: number) => void;
  onSortChange: (_column: 'dueDate' | 'paidAt' | 'payerName' | 'grossAmount') => void;
  sort: { columnId?: string; direction: 'ASC' | 'DESC' };
  onSelect: (_item: FinancialReportDetailItem) => void;
  receipts?: boolean;
  showHeader?: boolean;
};

function contextLinks(row: FinancialReportDetailItem) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
      {row.matriculaId && (
        <Link
          href={`/matriculas/${row.matriculaId}`}
          onClick={(event) => event.stopPropagation()}
          className="text-brand-accent hover:underline"
        >
          Matrícula
        </Link>
      )}
      {row.payerId && row.origin === 'ACADEMIC' && (
        <Link
          href={`/responsaveis/${row.payerId}`}
          onClick={(event) => event.stopPropagation()}
          className="text-brand-accent hover:underline"
        >
          Responsável
        </Link>
      )}
      {row.source === 'COBRANCA' && (
        <Link
          href={`/cobrancas/${row.sourceId}`}
          onClick={(event) => event.stopPropagation()}
          className="text-brand-accent hover:underline"
        >
          Cobrança
        </Link>
      )}
    </div>
  );
}

export function ReportDetailsTable({
  data,
  loading,
  timeZone,
  onPageChange,
  onSortChange,
  sort,
  onSelect,
  receipts,
  showHeader = true,
}: DetailProps) {
  const columns: DataTableColumn<FinancialReportDetailItem>[] = [
    {
      id: receipts ? 'paidAt' : 'dueDate',
      header: receipts ? 'Pagamento' : 'Vencimento',
      sortable: true,
      width: 'sm:w-[16%] xl:w-[14%]',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
      render: (row) => (
        <span className="tabular-nums">
          {formatReportDate(receipts ? row.paidAt : row.dueDate, timeZone)}
        </span>
      ),
    },
    {
      id: 'payerName',
      header: 'Responsável / aluno',
      sortable: true,
      width: 'w-[48%] sm:w-[38%] lg:w-[34%] xl:w-[28%]',
      noWrap: false,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{row.payerName}</p>
          <p className="truncate text-xs text-gray-500">{row.studentName ?? row.description ?? 'Cobrança avulsa'}</p>
          <p className="mt-0.5 text-[11px] text-gray-500 tabular-nums sm:hidden">
            {receipts ? 'Pago em' : 'Vence em'} {formatReportDate(receipts ? row.paidAt : row.dueDate, timeZone)}
          </p>
          {contextLinks(row)}
        </div>
      ),
    },
    {
      id: 'context',
      header: 'Contexto',
      width: 'w-[20%]',
      noWrap: false,
      headerClassName: 'hidden xl:table-cell',
      cellClassName: 'hidden xl:table-cell',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.turmaName ?? (row.origin === 'STANDALONE' ? 'Cobrança avulsa' : 'Sem turma')}</p>
          <p className="truncate text-xs text-gray-500">{row.planoName ?? TYPE_LABELS[row.type] ?? row.type}</p>
        </div>
      ),
    },
    {
      id: 'paymentMethod',
      header: 'Forma',
      width: 'w-[14%]',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (row) => PAYMENT_LABELS[row.paymentMethod ?? ''] ?? row.paymentMethod ?? '—',
    },
    {
      id: 'grossAmount',
      header: receipts ? 'Bruto / líquido' : 'Valor',
      sortable: true,
      align: 'right',
      width: 'w-[28%] sm:w-[24%] lg:w-[20%] xl:w-[14%]',
      render: (row) => (
        <div className="tabular-nums">
          <p className="font-medium">{formatReportMoney(receipts ? row.receivedAmount : row.grossAmount)}</p>
          {receipts && <p className="text-xs text-gray-500">{formatReportMoney(row.netAmount)} líquido</p>}
          {!receipts && row.outstandingAmount !== row.grossAmount && (
            <p className="text-xs text-gray-500">
              {formatReportMoney(row.outstandingAmount)} em aberto
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Situação',
      align: 'right',
      width: 'w-[24%] sm:w-[22%] lg:w-[18%] xl:w-[14%]',
      render: (row) => <Badge variant={statusVariant(row.status)} size="sm">{STATUS_LABELS[row.status]}</Badge>,
    },
  ];
  return (
    <section className="space-y-3" aria-labelledby="report-details-title">
      {showHeader ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-details-title" className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Registros que compõem o relatório</h2>
            <p className="text-xs text-gray-500">Abra uma linha para conferir a trilha financeira e acadêmica.</p>
          </div>
          <span className="text-xs font-medium text-gray-500 tabular-nums">{data.total.toLocaleString('pt-BR')} registros</span>
        </div>
      ) : (
        <div className="flex justify-end">
          <span className="text-xs font-medium text-gray-500 tabular-nums">{data.total.toLocaleString('pt-BR')} registros</span>
        </div>
      )}
      <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
        <DataTable
          ariaLabel="Detalhamento do relatório financeiro"
          data={data.items}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          skeletonRows={6}
          onRowClick={onSelect}
          sort={sort}
          onSortChange={(column) => onSortChange(column as 'dueDate' | 'paidAt' | 'payerName' | 'grossAmount')}
          containerClassName="rounded-none border-0"
          emptyMessage={<ReportEmptyState message={receipts ? 'Nenhum recebimento foi registrado neste período.' : 'Nenhuma cobrança foi encontrada com estes filtros.'} />}
        />
        {data.total > data.pageSize ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] sm:px-5 lg:px-6">
            <Pagination total={data.total} page={data.page} pageSize={data.pageSize} onChange={onPageChange} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function DelinquencyDetailsTable({
  data,
  loading,
  timeZone,
  onPageChange,
  showHeader = true,
}: {
  data: FinancialReportPage<DelinquencyGroupItem>;
  loading?: boolean;
  timeZone?: string;
  onPageChange: (_page: number) => void;
  showHeader?: boolean;
}) {
  const columns: DataTableColumn<DelinquencyGroupItem>[] = [
    {
      id: 'payer',
      header: 'Responsável financeiro',
      width: 'w-[56%] sm:w-[48%] lg:w-[34%] xl:w-[26%]',
      noWrap: false,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{row.payerName}</p>
          <p className="truncate text-xs text-gray-500">{row.payerEmail ?? row.payerPhone ?? 'Contato não informado'}</p>
          <p className="mt-0.5 truncate text-[11px] text-gray-500 lg:hidden">
            {row.studentNames.join(', ') || 'Cobrança avulsa'} · {row.turmaNames.join(', ') || 'Sem turma'}
          </p>
          {row.payerId && (
            <Link className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-accent hover:underline" href={`/responsaveis/${row.payerId}`}>
              Abrir responsável <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      ),
    },
    {
      id: 'students',
      header: 'Aluno(s) / turma',
      width: 'w-[24%]',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.studentNames.join(', ') || 'Cobrança avulsa'}</p>
          <p className="truncate text-xs text-gray-500">{row.turmaNames.join(', ') || 'Sem turma'}</p>
        </div>
      ),
    },
    {
      id: 'oldest',
      header: 'Mais antiga',
      width: 'w-[14%]',
      headerClassName: 'hidden xl:table-cell',
      cellClassName: 'hidden xl:table-cell',
      render: (row) => formatReportDate(row.oldestDueDate, timeZone),
    },
    {
      id: 'count',
      header: 'Cobranças',
      align: 'center',
      width: 'w-[12%]',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      render: (row) => row.chargeCount.toLocaleString('pt-BR'),
    },
    {
      id: 'days',
      header: 'Atraso',
      align: 'right',
      width: 'hidden sm:table-cell sm:w-[22%] lg:w-[16%] xl:w-[12%]',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
      render: (row) => <span className="font-medium text-red-600 tabular-nums">{row.daysOverdue} dias</span>,
    },
    {
      id: 'amount',
      header: 'Saldo em atraso',
      align: 'right',
      width: 'w-[44%] sm:w-[30%] lg:w-[26%] xl:w-[16%]',
      render: (row) => (
        <div>
          <p className="font-semibold text-red-600 tabular-nums">{formatReportMoney(row.overdueAmount)}</p>
          {row.chargeIds[0] && (
            <Link className="text-[11px] text-brand-accent hover:underline" href={`/cobrancas/${row.chargeIds[0]}`}>Ver cobranças</Link>
          )}
        </div>
      ),
    },
  ];
  return (
    <section className="space-y-3">
      {showHeader && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Responsáveis com cobranças em atraso</h2>
          <p className="text-xs text-gray-500">Ações direcionam aos fluxos existentes; o relatório não altera o estado financeiro.</p>
        </div>
      )}
      <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
        <DataTable
          ariaLabel="Responsáveis financeiros inadimplentes"
          data={data.items}
          columns={columns}
          rowKey={(row) => `${row.payerId ?? row.payerName}:${row.oldestDueDate}`}
          loading={loading}
          skeletonRows={6}
          containerClassName="rounded-none border-0"
          emptyMessage={<ReportEmptyState message="Não há cobranças em atraso com os filtros selecionados." />}
        />
        {data.total > data.pageSize ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] sm:px-5 lg:px-6">
            <Pagination total={data.total} page={data.page} pageSize={data.pageSize} onChange={onPageChange} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ReportDetailsDrawer({
  item,
  timeZone,
  onClose,
}: {
  item: FinancialReportDetailItem | null;
  timeZone?: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex flex-col overflow-y-auto">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>{item.description ?? TYPE_LABELS[item.type] ?? item.type}</SheetTitle>
              <SheetDescription>Trilha do registro financeiro local reconciliado.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-6 px-6 py-5">
              <div className="flex items-center justify-between">
                <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                <span className="text-xs text-gray-500">{item.origin === 'ACADEMIC' ? 'Cobrança acadêmica' : 'Cobrança avulsa'}</span>
              </div>
              <DrawerSection title="Composição">
                <DrawerValue label="Valor da cobrança" value={formatReportMoney(item.grossAmount)} />
                <DrawerValue label="Valor recebido" value={formatReportMoney(item.receivedAmount)} />
                <DrawerValue label="Saldo em aberto" value={formatReportMoney(item.outstandingAmount)} />
                <DrawerValue label="Taxas" value={formatReportMoney(item.feeAmount)} />
                <DrawerValue label="Estornos" value={formatReportMoney(item.refundedAmount)} />
                <DrawerValue label="Valor líquido" value={formatReportMoney(item.netAmount)} strong />
              </DrawerSection>
              <DrawerSection title="Datas">
                <DrawerValue label="Vencimento" value={formatReportDate(item.dueDate, timeZone)} />
                <DrawerValue label="Pagamento" value={formatReportDate(item.paidAt, timeZone)} />
                <DrawerValue label="Liquidação" value={formatReportDate(item.settledAt, timeZone)} />
                <DrawerValue label="Competência" value={formatReportDate(item.competenceAt, timeZone)} />
              </DrawerSection>
              <DrawerSection title="Contexto acadêmico-financeiro">
                <DrawerValue label="Responsável financeiro" value={item.payerName} />
                <DrawerValue label="Aluno" value={item.studentName ?? '—'} />
                <DrawerValue label="Turma" value={item.turmaName ?? '—'} />
                <DrawerValue label="Plano" value={item.planoName ?? '—'} />
                <DrawerValue label="Forma de pagamento" value={PAYMENT_LABELS[item.paymentMethod ?? ''] ?? item.paymentMethod ?? '—'} />
              </DrawerSection>
            </div>
            <SheetFooter className="flex-wrap">
              {item.payerId && item.origin === 'ACADEMIC' && <Button asChild variant="outline"><Link href={`/responsaveis/${item.payerId}`}>Responsável</Link></Button>}
              {item.matriculaId && <Button asChild variant="outline"><Link href={`/matriculas/${item.matriculaId}`}>Matrícula</Link></Button>}
              {item.source === 'COBRANCA' && <Button asChild><Link href={`/cobrancas/${item.sourceId}`}>Abrir cobrança</Link></Button>}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ReportEmptyState({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-primary)]">{message}</p>
      <p className="mt-1 text-xs text-gray-500">Ajuste o período ou limpe os filtros para ampliar a busca.</p>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="alusa-session-panel p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function DrawerValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'text-right tabular-nums'}>{value}</dd>
    </div>
  );
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'PAID') return 'success';
  if (status === 'OVERDUE') return 'destructive';
  if (status === 'PROCESSING' || status === 'OPEN') return 'warning';
  return 'neutral';
}
