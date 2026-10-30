'use client';

import { useState } from 'react';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing/commercial-model';

type Invitation = { id: string; schoolName: string; contactName: string; email: string; conditionType: string; planCode: string | null; studentCount: number | null; monthlyAmountCents: number | null; customBaseMonthlyAmountCents: number | null; customIncludedStudentCount: number | null; customMonthlyOverageAmountCents: number | null; stripePriceId: string | null; trialDays: number; status: string; currentConditionVersion: number };
export function InvitationEditor({ invitation }: { invitation: Invitation }) {
  const [conditionType, setConditionType] = useState(invitation.conditionType === 'CUSTOM' ? 'CUSTOM' : 'STANDARD');
  const [studentCount, setStudentCount] = useState(invitation.studentCount ?? 1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const accepted = invitation.status === 'ACCEPTED';
  const standardTarget = resolveSchoolCommercialTarget(studentCount);
  async function update(formData: FormData) {
    setBusy(true); setMessage('');
    const body = {
      ...(!accepted ? { schoolName: formData.get('schoolName'), contactName: formData.get('contactName') } : {}),
      conditionType, studentCount: Number(formData.get('studentCount')), trialDays: Number(formData.get('trialDays')),
      ...(conditionType === 'CUSTOM' ? {
        customBaseMonthlyAmountCents: Math.round(Number(formData.get('customBaseMonthlyAmount')) * 100),
        customIncludedStudentCount: Number(formData.get('customIncludedStudentCount')),
        customMonthlyOverageAmountCents: Math.round(Number(formData.get('customMonthlyOverageAmount')) * 100),
      } : {}),
    };
    try {
      const response = await fetch(`/api/admin/school-invitations/${invitation.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível atualizar.');
      setMessage(`Alterações registradas no histórico. ${accepted ? `Nova versão ${result.data.currentConditionVersion} publicada; a escola precisará aceitá-la no onboarding.` : ''}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar.'); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!window.confirm('Revogar este convite? O link deixa de funcionar imediatamente.')) return;
    const response = await fetch(`/api/admin/school-invitations/${invitation.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'REVOKE' }) });
    setMessage(response.ok ? 'Convite revogado.' : 'Não foi possível revogar o convite.');
  }
  return <section className="rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">{accepted ? 'Atualizar condição antes do billing' : 'Editar convite pendente'}</h2>
    {accepted ? <p className="mt-1 text-sm text-slate-600">Versão atual {invitation.currentConditionVersion}. A escola verá a nova condição no onboarding e deverá aceitá-la antes de continuar.</p> : null}
    <form action={update} className="mt-4 grid gap-3 sm:grid-cols-2">
      {!accepted ? <>
      <label className="grid gap-1 text-sm">Escola<input name="schoolName" defaultValue={invitation.schoolName} required className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Responsável<input name="contactName" defaultValue={invitation.contactName} required className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">E-mail do convite<input type="email" value={invitation.email} readOnly className="rounded-md border bg-slate-50 px-3 py-2" /><span className="text-xs text-slate-500">O e-mail não pode ser alterado. Revogue e emita outro convite para corrigir o endereço.</span></label>
      </> : null}
      <label className="grid gap-1 text-sm">Alunos previstos<input name="studentCount" type="number" min={1} max={100000} value={studentCount} onChange={(event) => setStudentCount(Number(event.target.value))} required className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Trial<select name="trialDays" defaultValue={invitation.trialDays} className="rounded-md border px-3 py-2">{[0,7,14,21,30,60,90].map((days) => <option key={days} value={days}>{days === 0 ? 'Sem teste' : `${days} dias`}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Condição<select value={conditionType} onChange={(event) => setConditionType(event.target.value)} className="rounded-md border px-3 py-2"><option value="STANDARD">Padrão</option><option value="CUSTOM">Personalizada</option></select></label>
      {conditionType === 'STANDARD' ? <div className="grid gap-1 text-sm"><span>Faixa derivada da quantidade prevista</span><output className="rounded-md border bg-slate-50 px-3 py-2">{standardTarget?.kind === 'SELF_SERVICE' ? standardTarget.band.name : 'Mais de 500 alunos: use condição personalizada'}</output></div> : <>
        <label className="grid gap-1 text-sm">Valor base mensal (R$)<input name="customBaseMonthlyAmount" type="number" min="0.01" step="0.01" defaultValue={invitation.customBaseMonthlyAmountCents == null ? '' : invitation.customBaseMonthlyAmountCents / 100} required className="rounded-md border px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">Alunos incluídos<input name="customIncludedStudentCount" type="number" min={1} defaultValue={invitation.customIncludedStudentCount ?? 1} required className="rounded-md border px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">Valor mensal por aluno excedente (R$)<input name="customMonthlyOverageAmount" type="number" min="0.01" step="0.01" defaultValue={invitation.customMonthlyOverageAmountCents == null ? '' : invitation.customMonthlyOverageAmountCents / 100} required className="rounded-md border px-3 py-2" /></label>
      </>}
      {conditionType === 'STANDARD' && studentCount > 500 ? <p role="alert" className="text-sm text-red-700 sm:col-span-2">Acima de 500 alunos, use condição personalizada e atendimento especializado.</p> : null}
      {message ? <p role="status" className="sm:col-span-2 text-sm text-violet-800">{message}</p> : null}
      <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="rounded-md bg-violet-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Salvar alterações</button>{!accepted ? <button type="button" onClick={revoke} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700">Revogar convite</button> : null}</div>
    </form>
  </section>;
}
