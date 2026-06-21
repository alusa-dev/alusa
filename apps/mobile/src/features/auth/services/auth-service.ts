import { mobileEnv } from '@/config/env';
import { createApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { expireSession } from '@/features/session/services/session-service';
import type { LoginInput, LoginResponse } from '../types/auth';

export type AuthService = {
  login(_input: LoginInput): Promise<LoginResponse>;
  logout(): Promise<void>;
};

const api = createApiClient({
  baseUrl: mobileEnv.apiUrl,
  onUnauthorized: () => expireSession(),
});

export const authService: AuthService = {
  async login(input) {
    if (!mobileEnv.mobileAuthEnabled) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message:
          'O contrato de autenticação mobile ainda não está habilitado no backend da Alusa.',
      });
    }

    return api.request<LoginResponse, LoginInput>({
      method: 'POST',
      path: '/api/mobile/auth/login',
      body: input,
    });
  },
  async logout() {
    return undefined;
  },
};
