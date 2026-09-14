import { authenticatedApi } from './auth-service';

export type PasswordChangeChannel = 'email' | 'whatsapp';

type ChallengeResponse = {
  challengeId: string;
  channel: PasswordChangeChannel;
  destination: string;
  expiresAt: string;
  resendAvailableAt: string;
};

export const passwordChangeService = {
  requestCode(channel: PasswordChangeChannel) {
    return authenticatedApi.request<ChallengeResponse, { channel: PasswordChangeChannel }>({
      method: 'POST',
      path: '/api/mobile/profile/password-change/challenge',
      body: { channel },
    });
  },

  verifyCode(input: { challengeId: string; code: string }) {
    return authenticatedApi.request<{ verificationToken: string; verificationExpiresAt: string }, typeof input>({
      method: 'POST',
      path: '/api/mobile/profile/password-change/verify',
      body: input,
    });
  },

  complete(input: {
    challengeId: string;
    verificationToken: string;
    newPassword: string;
    confirmPassword: string;
    revokeAllSessions: boolean;
  }) {
    return authenticatedApi.request<{ ok: true; revokedAllSessions: boolean }, typeof input>({
      method: 'POST',
      path: '/api/mobile/profile/password-change/complete',
      body: input,
    });
  },
};
