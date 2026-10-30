'use client';

import React, { useRef, useState } from 'react';

export function InvitationResender({ invitationId }: { invitationId: string }) {
  const key = useRef<string | null>(null);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function resend() {
    key.current ??= crypto.randomUUID();
    setBusy(true); setMessage(''); setUrl('');
    try {
      const response = await fetch(`/api/admin/school-invitations/${invitationId}/resend`, { method: 'POST', headers: { 'idempotency-key': key.current } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível reenviar.');
      key.current = null;
      setUrl(result.data.url ?? '');
      setMessage(getInvitationResendMessage(result.data.emailDeliveryStatus, result.data.reused));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível reenviar.'); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-2"><button type="button" onClick={resend} disabled={busy} className="w-fit rounded-md border px-4 py-2 text-sm disabled:opacity-60">{busy ? 'Reenviando…' : 'Reemitir e reenviar link (72h)'}</button><InvitationResendFeedback message={message} url={url} /></div>;
}

export function getInvitationResendMessage(status: string, reused = false): string {
  if (status === 'UNKNOWN') return 'A entrega do e-mail não foi confirmada. O link atualizado abaixo continua válido; use-o para compartilhar o convite.';
  if (reused) return 'Este reenvio já foi processado. Confira o e-mail ou use o link atualizado abaixo.';
  if (status === 'FAILED') return 'E-mail não entregue. Copie o link abaixo e envie manualmente.';
  return 'Novo link enviado por e-mail. O link anterior foi invalidado.';
}

export function InvitationResendFeedback({ message, url }: { message: string; url: string }) {
  return <>{message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}{url ? <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} aria-label="Link atualizado do convite" className="rounded-md border p-2 text-sm" /> : null}</>;
}
