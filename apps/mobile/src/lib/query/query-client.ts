import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/errors';

export function createMobileQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (isApiError(error)) {
            if (
              error.code === 'UNAUTHORIZED' ||
              error.code === 'FORBIDDEN' ||
              error.code === 'VALIDATION_ERROR'
            ) {
              return false;
            }
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
