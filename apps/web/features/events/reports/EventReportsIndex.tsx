'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { DataTable, type DataTableColumn } from '@/components/layout/DataTable';
import { Pagination } from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
import { EventEmptyState } from '../shared/EventEmptyState';
import { EventStatusBadge } from '../shared/EventStatusBadge';
import { formatDate, listEvents } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EventsFilters } from '../list/EventsFilters';

type EventReportIndexItem = Awaited<ReturnType<typeof listEvents>>['data'][number];

export function EventReportsIndex() {
  const { data: session, status: sessionStatus } = useSession();
  const contaId = session?.user?.contaId;
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const deferredSearch = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: [...eventQueryKeys.reports(undefined, undefined, contaId), page, deferredSearch, status, type],
    enabled: sessionStatus === 'authenticated' && Boolean(contaId),
    queryFn: () => listEvents({
      page,
      pageSize: 25,
      search: deferredSearch || undefined,
      status: status === 'ALL' ? undefined : status,
      type: type === 'ALL' ? undefined : type,
    }),
  });
  const events = query.data?.data ?? [];

  const columns: DataTableColumn<EventReportIndexItem>[] = [
    {
      id: 'event',
      header: 'Evento',
      width: 'w-[42%]',
      headerClassName: 'text-left',
      noWrap: false,
      render: (event) => (
        <Link
          href={`/events/reports/${event.id}`}
          aria-label={`Abrir relatório de ${event.name}`}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          className="inline-flex min-w-0 max-w-full items-center rounded-sm font-medium text-gray-900 outline-none transition-colors hover:text-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/30 alusa-dark:text-[color:var(--color-text-primary)]"
        >
          <span className="truncate">{event.name}</span>
        </Link>
      ),
    },
    {
      id: 'location',
      header: 'Local',
      width: 'w-[28%]',
      headerClassName: 'text-left',
      noWrap: false,
      render: (event) => <span className="block truncate">{event.locationName || 'Local não definido'}</span>,
    },
    {
      id: 'date',
      header: 'Data do evento',
      width: 'w-[16%]',
      headerClassName: 'text-left',
      render: (event) => <span className="tabular-nums">{formatDate(event.startsAt)}</span>,
    },
    {
      id: 'status',
      header: 'Situação',
      width: 'w-[14%]',
      align: 'center',
      headerClassName: 'text-center',
      render: (event) => <EventStatusBadge status={event.status} />,
    },
  ];

  return (
    <>
      <div className="alusa-session-panel rounded-xl border border-slate-200 bg-white px-3 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-4">
        <EventsFilters
          search={search}
          status={status}
          type={type}
          onSearchChange={(value) => { setSearch(value); setPage(1); }}
          onStatusChange={(value) => { setStatus(value); setPage(1); }}
          onTypeChange={(value) => { setType(value); setPage(1); }}
        />
      </div>

      <section aria-labelledby="event-report-list-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div>
            <h2 id="event-report-list-title" className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Eventos disponíveis</h2>
            <p className="mt-1 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              Clique em uma linha para abrir os detalhes financeiros e operacionais.
            </p>
          </div>
          {query.data ? (
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
              {query.data.meta.total.toLocaleString('pt-BR')} evento(s)
            </div>
          ) : null}
        </header>

        {query.isError ? (
          <div role="alert" className="px-6 py-8 text-sm text-destructive">
            <p>Não foi possível carregar os eventos.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} className="mt-3">
              Tentar novamente
            </Button>
          </div>
        ) : (
          <DataTable
            ariaLabel="Eventos disponíveis para relatório"
            data={events}
            columns={columns}
            rowKey={(event) => event.id}
            loading={query.isLoading}
            skeletonRows={6}
            tableClassName="min-w-[900px]"
            bodyClassName="[&_td]:py-4"
            emptyMessage={
              <div className="px-6 py-10 text-center">
                <EventEmptyState
                  title="Nenhum evento para relatar."
                  description="Os relatórios aparecerão aqui depois que você cadastrar um evento."
                />
              </div>
            }
            onRowClick={(event) => {
              router.push(`/events/reports/${event.id}`);
            }}
          />
        )}

        {query.data && query.data.meta.total > query.data.meta.pageSize ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
            <Pagination
              total={query.data.meta.total}
              page={query.data.meta.page}
              pageSize={query.data.meta.pageSize}
              onChange={setPage}
            />
          </div>
        ) : null}
      </section>
    </>
  );
}
