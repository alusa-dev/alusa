'use client';

import { EVENT_STATUS_LABELS, type SchoolEventStatus } from '@alusa/shared';

import { Badge } from '@/components/ui/badge';

export function EventStatusBadge({ status }: { status: SchoolEventStatus }) {
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'PLANNING'
        ? 'info'
        : status === 'CANCELLED'
          ? 'destructive'
          : status === 'FINISHED'
            ? 'neutral'
            : 'outline';

  return <Badge variant={variant}>{EVENT_STATUS_LABELS[status]}</Badge>;
}
