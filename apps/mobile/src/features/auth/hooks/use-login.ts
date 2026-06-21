import { useMutation, useQueryClient } from '@tanstack/react-query';

import { establishSession } from '@/features/session/services/session-service';
import { authService } from '../services/auth-service';
import type { LoginInput } from '../types/auth';

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    retry: false,
    onSuccess: async (session) => {
      queryClient.clear();
      await establishSession(session);
    },
  });
}
