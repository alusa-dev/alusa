import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';

import { createMobileQueryClient } from '@/lib/query/query-client';

export function QueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(createMobileQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
