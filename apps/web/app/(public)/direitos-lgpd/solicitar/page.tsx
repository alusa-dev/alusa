'use client';

import React, { useState } from 'react';

const requestTypes = [
  ['CONFIRMATION', 'Confirmacao de tratamento'],
  ['ACCESS', 'Acesso aos dados'],
  ['CORRECTION', 'Correcao'],
  ['ANONYMIZATION', 'Anonimizacao'],
  ['BLOCKING', 'Bloqueio'],
  ['DELETION', 'Eliminacao quando aplicavel'],
  ['PORTABILITY', 'Portabilidade'],
  ['SHARING_INFO', 'Informacao sobre compartilhamento'],
  ['CONSENT_REVOCATION', 'Revogacao de consentimento'],
  ['OPPOSITION', 'Oposicao'],
  ['AUTOMATED_DECISION_REVIEW', 'Revisao de decisao automatizada'],
] as const;

export default function LgpdRequestPage() {
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch('/api/privacy/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requesterName: formData.get('requesterName'),
        requesterEmail: formData.get('requesterEmail'),
        requestType: formData.get('requestType'),
        details: formData.get('details'),
      }),
    }).catch(() => null);

    setSubmitting(false);
    if (!response?.ok) {
      setStatus({ type: 'error', message: 'Nao foi possivel registrar a solicitacao. Revise os dados e tente novamente.' });
      return;
    }

    const body = (await response.json().catch(() => ({}))) as { requestId?: string };
    setStatus({ type: 'success', message: `Solicitacao registrada${body.requestId ? `: ${body.requestId}` : ''}.` });
    event.currentTarget.reset();
  }

  return (
    <main className="bg-white text-[#1d1230]">
      <section className="border-b border-slate-200 bg-[#f8f5ff]">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6b3bb1]">LGPD</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Solicitar atendimento LGPD</h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-700">
            Use este canal para exercer direitos relacionados a dados pessoais tratados na Alusa.
            Podemos solicitar validacao de identidade ou envolver a escola controladora quando necessario.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
        <form onSubmit={submit} className="space-y-5" data-sentry-mask>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-800">Nome</span>
              <input name="requesterName" required minLength={2} className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-[#6b3bb1]" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-800">E-mail</span>
              <input name="requesterEmail" type="email" required className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-[#6b3bb1]" />
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-800">Tipo de solicitacao</span>
            <select name="requestType" required className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-[#6b3bb1]">
              {requestTypes.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-800">Detalhes</span>
            <textarea name="details" required minLength={10} rows={7} className="w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-[#6b3bb1]" />
          </label>
          {status ? (
            <p className={status.type === 'success' ? 'text-sm font-medium text-emerald-700' : 'text-sm font-medium text-red-700'}>
              {status.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#430D88] px-6 text-sm font-semibold text-white hover:bg-[#35106a] disabled:opacity-60"
          >
            {submitting ? 'Enviando...' : 'Enviar solicitacao'}
          </button>
        </form>
      </section>
    </main>
  );
}
