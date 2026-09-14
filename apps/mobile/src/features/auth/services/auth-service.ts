import { mobileEnv } from '@/config/env';
import type { QueryClient } from '@tanstack/react-query';
import { createApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import {
  clearSession,
  establishSession,
  expireSession,
  lockSession,
} from '@/features/session/services/session-service';
import { useSessionStore } from '@/features/session/stores/session-store';
import type {
  LoginInput,
  LoginResponse,
  PasswordResetRequest,
  ProfileUpdateInput,
  ProfileUpdateResponse,
} from '../types/auth';

export type AuthService = {
  login(_input: LoginInput): Promise<LoginResponse>;
  refresh(_refreshToken: string, _contaId?: string | null): Promise<LoginResponse>;
  requestPasswordReset(_input: PasswordResetRequest): Promise<void>;
  updateProfile(_input: ProfileUpdateInput): Promise<ProfileUpdateResponse>;
  uploadProfilePhoto(_formData: FormData): Promise<{ url: string }>;
  logout(_queryClient?: QueryClient, _options?: { preserveSavedAccess?: boolean }): Promise<void>;
};

const api = createApiClient({
  baseUrl: mobileEnv.apiUrl,
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  const refreshToken = useSessionStore.getState().session?.refreshToken;
  if (!refreshToken) return null;

  refreshPromise = authService
    .refresh(refreshToken, useSessionStore.getState().activeContaId)
    .then(async (session) => {
      await establishSession(session);
      return session.accessToken;
    })
    .catch(async () => {
      await expireSession();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export const authenticatedApi = createApiClient({
  baseUrl: mobileEnv.apiUrl,
  getAccessToken: () => useSessionStore.getState().session?.accessToken ?? null,
  refreshAccessToken,
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
      accessToken: null,
    });
  },
  async refresh(refreshToken, contaId) {
    if (!mobileEnv.mobileAuthEnabled) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'A autenticação mobile ainda não está habilitada.',
      });
    }

    return api.request<LoginResponse, { refreshToken: string; contaId?: string | null }>({
      method: 'POST',
      path: '/api/mobile/auth/refresh',
      body: { refreshToken, contaId },
      accessToken: null,
    });
  },
  async requestPasswordReset(input) {
    if (!mobileEnv.mobileAuthEnabled) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'A autenticação mobile ainda não está habilitada.',
      });
    }

    await api.request<void, PasswordResetRequest>({
      method: 'POST',
      path: '/api/mobile/auth/password-reset/request',
      body: input,
      accessToken: null,
    });
  },
  async updateProfile(input) {
    return authenticatedApi.request<ProfileUpdateResponse, ProfileUpdateInput>({
      method: 'PATCH',
      path: '/api/mobile/profile',
      body: input,
    });
  },
  async uploadProfilePhoto(formData) {
    return authenticatedApi.request<{ url: string }, FormData>({
      method: 'POST',
      path: '/api/mobile/profile',
      body: formData,
    });
  },
  async logout(queryClient, options) {
    const refreshToken = useSessionStore.getState().session?.refreshToken;
    if (options?.preserveSavedAccess) {
      await lockSession(queryClient);
      return;
    }

    try {
      if (refreshToken) {
        await api.request<void, { refreshToken: string }>({
          method: 'POST',
          path: '/api/mobile/auth/logout',
          body: { refreshToken },
          accessToken: null,
        });
      }
    } finally {
      await clearSession(queryClient);
    }
  },
};
