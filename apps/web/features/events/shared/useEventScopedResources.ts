'use client';

import { useQuery } from '@tanstack/react-query';

import { listEventScopedResources } from '../events-service';
import { eventQueryKeys } from './event-query-keys';

export function useEventScopedResources(eventId: string | undefined) {
  return useQuery({
    queryKey: eventId ? eventQueryKeys.scopedResources(eventId) : ['events', 'scoped-resources', 'none'],
    queryFn: () => listEventScopedResources(eventId!),
    enabled: Boolean(eventId),
    staleTime: 60_000,
  });
}
