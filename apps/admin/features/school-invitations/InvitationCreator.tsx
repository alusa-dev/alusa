'use client';

import { useRef, useState } from 'react';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing/commercial-model';

export function InvitationCreator() {
  const [conditionType, setConditionType] = useState<'STANDARD' | 'CUSTOM'>('STANDARD');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [studentCount, setStudentCount] = useState(25);
  const [baseMonthly, setBaseMonthly] = useState('');
  const [includedStudents, setIncludedStudents] = useState(25);
  const [overagePerStudent, setOveragePerStudent] = useState('');
  const requestKey = useRef<string | null>(null);
  const standardTarget = resolveSchoolCommercialTarget(studentCount);
  const standardBandLabel = standardTarget?.kind === 'SELF_SERVICE' ? standardTarget.band.name : null;

  async function submit(formData: FormData) {
    setBusy(true); setError(''); setNotice(''); setUrl('');
    requestKey.current ??= crypto.randomUUID();
    const body = {
      schoolName: formData.get('schoolName'), contactName: formData.get('contactName'), email: formData.get('email'),
      conditionType, studentCount: Number(formData.get('studentCount')),
      trialDays: Number(formData.get('trialDays')),
      expirationHours: Number(formData.get('expirationHours')),
      ...(conditionType === 'CUSTOM' ? {
        customBaseMonthlyAmountCents: Math.round(Number(formData.get('customBaseMonthlyAmount')) * 100),
        customIncludedStudentCount: Number(formData.get('customIncludedStudentCount')),
        customMonthlyOverageAmountCents: Math.round(Number(formData.get('customMonthlyOverageAmount')) * 100),
      } : {}),
    };
    try {
      const response = await fetch('/api/admin/school-invitations', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestKey.current }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Revise os dados e tente novamente.');
      requestKey.current = null;
      setUrl(result.data.url ?? '');
      if (result.data.reused) setNotice('Este envio já criou um convite. Confira o e-mail ou reemita um link em Detalhes.');
      else if (result.data.emailDeliveryStatus === 'FAILED') setNotice(`Convite criado, mas o e-mail falhou (${result.data.emailDeliveryErrorCode ?? 'erro de entrega'}). Copie o link e tente reenviar em Detalhes.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o convite.'); }
    finally { setBusy(false); }
  }

  return <form action={submit} className="grid max-w-3xl gap-4 rounded-xl border bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold">Novo convite</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Escola<input name="schoolName" required minLength={2} className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Responsável<input name="contactName" required minLength={2} className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">E-mail<input name="email" type="email" required className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Alunos previstos<input name="studentCount" type="number" min={1} max={100000} value={studentCount} onChange={(event) => setStudentCount(Number(event.target.value))} required className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Teste grátis<select name="trialDays" defaultValue={14} className="rounded-md border px-3 py-2">{[0,7,14,21,30,60,90].map((d) => <option key={d} value={d}>{d === 0 ? 'Sem teste' : `${d} dias`}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Validade do link (horas)<input name="expirationHours" type="number" min={1} max={720} defaultValue={72} className="rounded-md border px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">Condição<select value={conditionType} onChange={(event) => setConditionType(event.target.value as 'STANDARD' | 'CUSTOM')} className="rounded-md border px-3 py-2"><option value="STANDARD">Padrão</option><option value="CUSTOM">Personalizada</option></select></label>
      {conditionType === 'STANDARD' ? <div className="grid gap-1 text-sm sm:col-span-2"><span>Faixa inicial estimada (cliente poderá ajustar no onboarding)</span><output className="rounded-md border bg-slate-50 px-3 py-2">{standardBandLabel ?? 'Mais de 500 alunos: use condição personalizada'}</output></div> : <>
        <label className="grid gap-1 text-sm">Valor base mensal (R$)<input name="customBaseMonthlyAmount" type="number" min="0.01" step="0.01" value={baseMonthly} onChange={(event) => setBaseMonthly(event.target.value)} required className="rounded-md border px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">Alunos incluídos<input name="customIncludedStudentCount" type="number" min={1} max={100000} value={includedStudents} onChange={(event) => setIncludedStudents(Number(event.target.value))} required className="rounded-md border px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">Valor mensal por aluno excedente (R$)<input name="customMonthlyOverageAmount" type="number" min="0.01" step="0.01" value={overagePerStudent} onChange={(event) => setOveragePerStudent(event.target.value)} required className="rounded-md border px-3 py-2" /></label>
        <div className="rounded-md bg-violet-50 p-3 text-sm sm:col-span-2">Mensalidade estimada para {studentCount} alunos: <strong>{((Math.round(Number(baseMonthly || 0) * 100) + Math.max(0, studentCount - includedStudents) * Math.round(Number(overagePerStudent || 0) * 100)) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês</strong>. O preço recorrente será calculado automaticamente com base no total de alunos informado.</div>
      </>}
    </div>
    {conditionType === 'STANDARD' && !standardBandLabel ? <p role="alert" className="text-sm text-red-700">Acima de 500 alunos, selecione condição personalizada para criar o convite.</p> : null}
    {conditionType === 'CUSTOM' ? <p className="text-sm text-slate-600">O cliente verá o valor base, a quantidade incluída e a taxa por aluno excedente; o Stripe cobrará pela tabela mensal acordada. A condição não é recalculada como faixa pública.</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-amber-800">{notice}</p> : null}
    {url ? <div className="grid gap-2 rounded-md bg-emerald-50 p-3 text-sm"><strong>Convite criado. Copie e envie o link:</strong><input readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="rounded border bg-white p-2" /></div> : null}
    <button disabled={busy || (conditionType === 'STANDARD' && !standardBandLabel)} className="w-fit rounded-md bg-violet-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Criando…' : 'Criar convite'}</button>
  </form>;
}
