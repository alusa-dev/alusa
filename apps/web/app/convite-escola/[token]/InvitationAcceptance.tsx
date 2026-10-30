'use client';

import { useEffect, useState } from 'react';
import { requiredRegisterLegalDocuments } from '@/lib/privacy/legal-versions';

type Invitation = { status?: string; schoolName: string; contactName?: string; email: string; conditionType?: string; planCode?: string | null; monthlyAmountCents?: number | null; customBaseMonthlyAmountCents?: number | null; customIncludedStudentCount?: number | null; customMonthlyOverageAmountCents?: number | null; studentCount?: number | null; trialDays?: number; expiresAt?: string; next?: string };
type LoadState = { invitation: Invitation | null; error: string };

export function InvitationAcceptance({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ invitation: null, error: 'Carregando convite…' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const docs = requiredRegisterLegalDocuments();
  useEffect(() => {
    let active = true;
    fetch(`/api/public/school-invitations/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Convite indisponível.'); return result.data as Invitation; })
      .then((invitation) => { if (active) setState({ invitation, error: '' }); })
      .catch((error: unknown) => { if (active) setState({ invitation: null, error: error instanceof Error ? error.message : 'Convite indisponível.' }); });
    return () => { active = false; };
  }, [token]);

  async function submit(formData: FormData) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/public/school-invitations/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: formData.get('firstName'), lastName: formData.get('lastName'), senha: formData.get('password'), confirmacaoSenha: formData.get('passwordConfirmation'),
          acceptLegal: formData.get('acceptLegal') === 'on',
          legalAcceptance: { accepted: true, source: 'REGISTER', locale: 'pt-BR', documents: docs.map((doc) => ({ documentType: doc.type, documentVersion: doc.version })) } }),
      });
      const result = await response.json();
      if (response.ok && result.data?.status === 'ACCEPTED') {
        setState((current) => ({ ...current, invitation: { status: 'ACCEPTED', schoolName: current.invitation?.schoolName ?? 'Sua escola', email: result.data.email ?? current.invitation?.email ?? '', next: result.data.next }, error: '' }));
        return;
      }
      setMessage(result.error ?? 'Não foi possível concluir o cadastro. Confira os dados e tente novamente.');
    } catch {
      setMessage('Não foi possível concluir a solicitação agora. Seus dados continuam preenchidos; tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (!state.invitation) return <section className="grid gap-3 rounded-2xl border bg-white p-6 shadow-sm"><h1 className="text-xl font-semibold">Convite para sua escola</h1><p role="status" className="text-sm text-slate-600">{state.error}</p></section>;
  const invitation = state.invitation;
  if (invitation.status === 'ACCEPTED') return <section className="grid gap-4 rounded-2xl border bg-white p-6 shadow-sm"><h1 className="text-2xl font-semibold">Convite já aceito</h1><p className="text-sm text-slate-600">O acesso de {invitation.schoolName} foi criado. Entre com {invitation.email} e confirme seu e-mail para continuar a configuração.</p><a className="w-fit rounded-md bg-violet-800 px-4 py-3 font-semibold text-white" href={invitation.next ?? '/auth/login?callbackUrl=%2Ffinance%2Fwizard'}>Entrar na Alusa</a></section>;
  return <section className="grid gap-5 rounded-2xl border bg-white p-6 shadow-sm">
    <div><p className="text-sm font-medium text-violet-800">Convite comercial da Alusa</p><h1 className="mt-1 text-2xl font-semibold">{invitation.schoolName}</h1><p className="mt-2 text-sm text-slate-600">Preencha os dados de acesso para aceitar o convite.</p></div>
    <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">E-mail do convite</dt><dd className="font-medium">{invitation.email}</dd></div><div><dt className="text-slate-500">Responsável</dt><dd className="font-medium">{invitation.contactName}</dd></div><div><dt className="text-slate-500">Condição</dt><dd>{invitation.conditionType === 'CUSTOM' ? `Personalizada · ${((invitation.monthlyAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês no total estimado` : `Padrão · ${invitation.planCode?.replaceAll('_', ' ')}`}</dd></div>{invitation.conditionType === 'CUSTOM' ? <div><dt className="text-slate-500">Preço personalizado</dt><dd>Base {((invitation.customBaseMonthlyAmountCents ?? invitation.monthlyAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês, inclui {invitation.customIncludedStudentCount ?? 0} alunos; acima disso, {((invitation.customMonthlyOverageAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/aluno/mês.</dd></div> : null}<div><dt className="text-slate-500">Teste</dt><dd>{invitation.trialDays ? `${invitation.trialDays} dias, após a configuração inicial` : 'Sem período de teste'}</dd></div></dl>
    <p className="text-sm text-slate-600">A configuração financeira será feita depois de confirmar seu e-mail. Nenhuma assinatura ou cobrança é criada ao aceitar este convite.</p>
    <form action={submit} className="grid gap-4">
      <label className="grid gap-1 text-sm">E-mail<input value={invitation.email} readOnly className="rounded-md border bg-slate-50 px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Nome<input name="firstName" type="text" autoComplete="given-name" required maxLength={100} className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Sobrenome<input name="lastName" type="text" autoComplete="family-name" required maxLength={100} className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Senha<input name="password" type="password" required autoComplete="new-password" className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Confirme a senha<input name="passwordConfirmation" type="password" required autoComplete="new-password" className="rounded-md border px-3 py-2" /></label>
      <label className="flex items-start gap-2 text-sm"><input name="acceptLegal" type="checkbox" required className="mt-1" /><span>Li e aceito {docs.map((doc, index) => <span key={doc.type}>{index > 0 ? ', ' : ''}<a className="text-violet-800 underline" href={doc.href} target="_blank" rel="noreferrer">{doc.title}</a> (versão {doc.version})</span>)}.</span></label>
      {message ? <p role="status" className="text-sm text-violet-800">{message}</p> : null}
      <button disabled={busy} className="rounded-md bg-violet-800 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? 'Concluindo…' : 'Aceitar convite e criar acesso'}</button>
    </form>
  </section>;
}
