'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

type WhatsAppTestStatus = {
  enabled: boolean;
  testMode: boolean;
  configured: boolean;
  phoneNumberId: string | null;
  testAllowlistCount: number;
};

type Props = { status: WhatsAppTestStatus };

export default function WhatsAppTestFeature({ status }: Props) {
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'template' | 'text'>('template');
  const [body, setBody] = useState('Mensagem de teste da Alusa.');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch('/api/comunicacao/whatsapp/teste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, mode, body: mode === 'text' ? body : undefined }),
      });
      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; status?: string; messageId?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(result?.error ?? 'Não foi possível enviar a mensagem.');

      setFeedback(`Mensagem ${result?.status === 'SENT' ? 'enviada' : 'enfileirada'} com sucesso${result?.messageId ? ` (${result.messageId})` : ''}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao enviar mensagem.');
    } finally {
      setLoading(false);
    }
  }

  const operational = status.enabled && status.testMode && status.configured && status.testAllowlistCount > 0;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 md:p-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-violet-700">Comunicação · WhatsApp Cloud API</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Página de teste da Alusa</h1>
        <p className="text-sm leading-6 text-slate-600">
          A página exige apenas a sessão normal da Alusa. Não há uma permissão extra por envio; o destinatário é protegido pela allowlist de testes do ambiente.
        </p>
      </header>

      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
        <Status label="Integração" value={status.enabled ? 'Habilitada' : 'Desabilitada'} ok={status.enabled} />
        <Status label="Modo de teste" value={status.testMode ? 'Ativo' : 'Inativo'} ok={status.testMode} />
        <Status label="Allowlist" value={`${status.testAllowlistCount} destinatário(s)`} ok={status.testAllowlistCount > 0} />
      </div>

      {!operational ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
          Configure as variáveis `WHATSAPP_ENABLED=true`, `WHATSAPP_TEST_MODE=true`, as credenciais do app e `WHATSAPP_TEST_ALLOWLIST` antes de enviar.
        </div>
      ) : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800" htmlFor="whatsapp-test-to">Número destinatário</label>
          <input
            id="whatsapp-test-to"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+55 97 98128-3106"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none ring-violet-500 focus:ring-2"
            required
          />
          <p className="text-xs text-slate-500">Use o mesmo número incluído como destinatário de teste na Meta, com DDI.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">Tipo de mensagem</legend>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'template'} onChange={() => setMode('template')} /> Template hello_world</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'text'} onChange={() => setMode('text')} /> Texto</label>
          </div>
        </fieldset>

        {mode === 'text' ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-800" htmlFor="whatsapp-test-body">Mensagem</label>
            <textarea id="whatsapp-test-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4096} rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none ring-violet-500 focus:ring-2" required />
          </div>
        ) : null}

        <button type="submit" disabled={loading || !operational} className="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? 'Enviando…' : 'Enviar mensagem de teste'}
        </button>
      </form>

      {feedback ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{feedback}</p> : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    </section>
  );
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={ok ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>{value}</p>
    </div>
  );
}
