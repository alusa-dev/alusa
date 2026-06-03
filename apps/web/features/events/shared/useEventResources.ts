'use client';

import { useQuery } from '@tanstack/react-query';

import { listResources } from '../events-service';
import { eventQueryKeys } from './event-query-keys';

export function useEventResources() {
  return useQuery({
    queryKey: eventQueryKeys.resources,
    queryFn: listResources,
    staleTime: 60_000,
  });
}
