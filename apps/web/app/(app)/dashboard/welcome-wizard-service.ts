'use client';

import { welcomeWizardStatusDTOSchema } from '@/features/users/dtos';

export async function fetchWelcomeWizardStatus(signal?: AbortSignal) {
  const response = await fetch('/api/users/me/welcome-wizard', {
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(typeof json?.error === 'string' ? json.error : 'Falha ao carregar boas-vindas');
  }

  const parsed = welcomeWizardStatusDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inesperada do servidor');
  }

  return parsed.data;
}

export async function dismissWelcomeWizard() {
  const response = await fetch('/api/users/me/welcome-wizard', {
    method: 'PATCH',
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(typeof json?.error === 'string' ? json.error : 'Falha ao salvar boas-vindas');
  }

  const parsed = welcomeWizardStatusDTOSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inesperada do servidor');
  }

  return parsed.data;
}