import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type PropsWithChildren } from 'react';

import { hydrateSession } from '@/features/session/services/session-service';

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    hydrateSession().catch(() => {
      if (active) queryClient.clear();
    });
    return () => {
      active = false;
    };
  }, [queryClient]);

  return children;
}
