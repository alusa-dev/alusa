'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { revokeAllSessions } from '@/lib/client/logout';

export function SessionSecurityActions() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRevokeAllSessions() {
    if (isSubmitting) return;

    const confirmed = window.confirm(
      'Isso encerrará sua sessão em todos os dispositivos. Deseja continuar?',
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      await revokeAllSessions('/auth/login?sessions=revoked');
    } catch {
      setIsSubmitting(false);
      window.alert('Não foi possível encerrar as outras sessões. Tente novamente.');
    }
  }

  return (
    <section className="max-w-3xl space-y-3 border-t border-gray-200 pt-6" aria-labelledby="sessions-title">
      <div className="space-y-1">
        <h3 id="sessions-title" className="text-base font-medium text-gray-900">
          Sessões conectadas
        </h3>
        <p className="text-sm text-gray-600">
          Encerre o acesso em todos os dispositivos onde sua conta está conectada.
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void handleRevokeAllSessions()}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Encerrando sessões...' : 'Sair de todos os dispositivos'}
      </Button>
    </section>
  );
}
