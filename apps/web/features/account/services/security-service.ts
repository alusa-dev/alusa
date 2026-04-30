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
