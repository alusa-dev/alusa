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
    <section
      aria-labelledby="sessions-title"
      className="grid gap-6 rounded-[10px] border border-[#e2e0e6] bg-white px-5 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:grid-cols-[1fr_auto] md:items-start md:px-6"
    >
      <div className="space-y-1">
        <h3 id="sessions-title" className="text-xl font-medium text-black alusa-dark:text-[color:var(--color-text-primary)]">
          Encerra sessões
        </h3>
        <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
          Encerre o acesso em todos os dispositivos onde sua conta está conectada.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleRevokeAllSessions()}
        disabled={isSubmitting}
        className="h-[34px] rounded-[5px] border-[#cf322a] px-4 text-sm font-medium text-[#9b231d] shadow-none hover:bg-red-50 hover:text-[#9b231d] alusa-dark:border-red-400/60 alusa-dark:bg-transparent alusa-dark:text-red-200 alusa-dark:hover:bg-red-500/10"
      >
        {isSubmitting ? 'Encerrando sessões...' : 'Sair de todos os dispositivos'}
      </Button>
    </section>
  );
}
