'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? 'Ação não concluída');
  return json;
}

export function SupportNoteForm({
  contaId,
  entityType,
  entityId,
}: {
  contaId: string;
  entityType: string;
  entityId: string;
}) {
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    setMessage(null);
    try {
      await postJson('/api/developer/actions/note', { contaId, entityType, entityId, body, reason });
      setBody('');
      setReason('');
      setState('success');
      setMessage('Nota registrada.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Erro ao registrar nota.');
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="support-note">Nota interna</Label>
        <Textarea id="support-note" value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-note-reason">Motivo</Label>
        <Input id="support-note-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <Button type="submit" disabled={state === 'loading'}>
        {state === 'loading' ? 'Registrando...' : 'Adicionar nota'}
      </Button>
    </form>
  );
}

export function SupportCaseForm({
  contaId,
  entityType,
  entityId,
}: {
  contaId: string;
  entityType?: string;
  entityId?: string;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    setMessage(null);
    try {
      await postJson('/api/developer/actions/case', {
        contaId,
        title,
        description,
        entityType,
        entityId,
        reason,
      });
      setTitle('');
      setDescription('');
      setReason('');
      setState('success');
      setMessage('Caso aberto.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Erro ao abrir caso.');
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="support-case-title">Título</Label>
        <Input id="support-case-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-case-description">Descrição</Label>
        <Textarea
          id="support-case-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-case-reason">Motivo</Label>
        <Input id="support-case-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <Button type="submit" disabled={state === 'loading'}>
        {state === 'loading' ? 'Abrindo...' : 'Abrir caso'}
      </Button>
    </form>
  );
}

export function SupportSafeActionButton({
  label,
  endpoint,
  payload,
}: {
  label: string;
  endpoint: string;
  payload: Record<string, unknown>;
}) {
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setState('loading');
    setMessage(null);
    try {
      await postJson(endpoint, { ...payload, reason });
      setState('success');
      setMessage('Ação concluída e auditada.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Ação não concluída.');
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <Label>Motivo obrigatório</Label>
      <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <Button type="button" variant="outline" onClick={submit} disabled={state === 'loading'}>
        {state === 'loading' ? 'Executando...' : label}
      </Button>
    </div>
  );
}
