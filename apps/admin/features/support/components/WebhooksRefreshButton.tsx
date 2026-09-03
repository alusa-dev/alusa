'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Icon } from '@/components/icons/Icon';

export function WebhooksRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refreshWebhooks() {
    if (loading) return;
    setLoading(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/admin/webhooks/health', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: { interruptedFound?: number };
      } | null;

      if (!response.ok || !body?.success) {
        setFeedback(body?.error ?? 'Não foi possível atualizar os eventos.');
        return;
      }

      setFeedback(body.data?.interruptedFound ? 'Webhook interrompido detectado.' : 'Atualizado.');
      router.refresh();
    } catch {
      setFeedback('Falha de rede ao atualizar os eventos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="support-webhooks-refresh-control">
      <button type="button" className="support-webhooks-refresh-button" onClick={refreshWebhooks} disabled={loading}>
        <Icon name="ArrowPath" size={15} aria-hidden="true" />
        {loading ? 'Atualizando…' : 'Atualizar'}
      </button>
      {feedback ? <span className="support-webhooks-refresh-feedback" role="status">{feedback}</span> : null}
    </div>
  );
}
