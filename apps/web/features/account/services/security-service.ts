import { ProfileUpdateError } from './profile-service';
import {
  changeEmailResultDTOSchema,
  simpleSuccessResultDTOSchema,
} from '@/features/users/dtos';

function parseError(json: unknown, fallback: string) {
  if (!json || typeof json !== 'object') return fallback;
  const data = json as {
    error?:
      | string
      | {
          formErrors?: string[];
          fieldErrors?: Record<string, string[]>;
        };
  };
  if (typeof data.error === 'string') return data.error;
  if (data.error?.formErrors?.length) return data.error.formErrors[0] ?? fallback;
  const field = data.error?.fieldErrors && Object.values(data.error.fieldErrors)[0];
  if (field?.length) return field[0] ?? fallback;
  return fallback;
}

export async function changePassword(payload: { currentPassword: string; newPassword: string }) {
  const res = await fetch('/api/users/me/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ProfileUpdateError(parseError(json, 'Falha ao atualizar senha'), {
      status: res.status,
      fieldErrors:
        (json?.error as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors,
      formErrors: (json?.error as { formErrors?: string[] } | null)?.formErrors,
    });
  }

  const parsed = simpleSuccessResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inesperada do servidor');
  }
  return parsed.data;
}

export type PasswordChangeChannel = 'email' | 'whatsapp';

type PasswordChangeChallengeResponse = {
  challengeId: string;
  channel: PasswordChangeChannel;
  destination: string;
  expiresAt: string;
  resendAvailableAt: string;
};

async function parseSecurityResponse<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(json?.error || fallback);
  }
  return json as T;
}

export async function requestPasswordChangeOtp(channel: PasswordChangeChannel) {
  const res = await fetch('/api/users/me/password-change/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  return parseSecurityResponse<PasswordChangeChallengeResponse>(res, 'Não foi possível enviar o código.');
}

export async function verifyPasswordChangeOtp(payload: { challengeId: string; code: string }) {
  const res = await fetch('/api/users/me/password-change/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseSecurityResponse<{ verificationToken: string; verificationExpiresAt: string }>(
    res,
    'Não foi possível validar o código.',
  );
}

export async function completePasswordChange(payload: {
  challengeId: string;
  verificationToken: string;
  newPassword: string;
  confirmPassword: string;
  revokeAllSessions: boolean;
}) {
  const res = await fetch('/api/users/me/password-change/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseSecurityResponse<{ ok: true; revokedAllSessions: boolean }>(
    res,
    'Não foi possível atualizar a senha.',
  );
}

export async function changeEmail(payload: { newEmail: string; currentPassword: string }) {
  const res = await fetch('/api/users/me/email', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ProfileUpdateError(parseError(json, 'Falha ao atualizar email'), {
      status: res.status,
      fieldErrors:
        (json?.error as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors,
      formErrors: (json?.error as { formErrors?: string[] } | null)?.formErrors,
    });
  }

  const parsed = changeEmailResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inesperada do servidor');
  }
  return parsed.data;
}
