'use client';

import { useQuery } from '@tanstack/react-query';

import { formatDateTime, listEventAudit } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { eventQueryKeys } from '../shared/event-query-keys';

export function EventAuditPanel({ eventId }: { eventId: string }) {
  const audit = useQuery({ queryKey: eventQueryKeys.audit(eventId), queryFn: () => listEventAudit(eventId) });
  return (
    <div className="space-y-3">
      {(audit.data ?? []).map((item) => (
        <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-950">{item.action}</p>
            <span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{item.entityType} · {item.actor?.nome || 'Sistema'}</p>
        </div>
      ))}
      {!audit.isLoading && !audit.data?.length ? <EmptyState title="Sem histórico ainda." description="Alterações operacionais e financeiras aparecerão aqui." /> : null}
    </div>
  );
}
