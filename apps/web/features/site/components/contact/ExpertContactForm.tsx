'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckIcon } from '@heroicons/react/24/outline';
import { EXPERT_CONTACT_INSTITUTION_TYPES, EXPERT_CONTACT_STUDENT_RANGES } from '@/features/public/dtos';

type FormValues = {
  contactName: string;
  email: string;
  institutionName: string;
  phone: string;
  institutionType: string;
  studentsRange: string;
  website: string;
};

const emptyForm: FormValues = {
  contactName: '',
  email: '',
  institutionName: '',
  phone: '',
  institutionType: '',
  studentsRange: '',
  website: '',
};

const ALUSA_WHATSAPP = '5597981283106';
const RECONCILIATION_SESSION_KEY = 'alusa-expert-contact-reconciliation-required';

function buildWhatsAppUrl(form: FormValues): string {
  const message = [
    'Olá! Tenho interesse em conhecer a Alusa e iniciar um período de teste.',
    '',
    `Nome: ${form.contactName}`,
    `E-mail: ${form.email}`,
    `Escola: ${form.institutionName}`,
    `WhatsApp: ${form.phone}`,
    `Tipo de instituição: ${form.institutionType}`,
    `Alunos: ${form.studentsRange}`,
  ].join('\n');
  return `https://wa.me/${ALUSA_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

function rangeFromCount(rawCount: string | null): string {
  if (!rawCount || !/^\d+$/.test(rawCount)) return '';
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 1) return '';
  if (count > 500) return 'Mais de 500';
  if (count <= 25) return '1 a 25';
  if (count <= 50) return '26 a 50';
  if (count <= 100) return '51 a 100';
  if (count <= 150) return '101 a 150';
  if (count <= 200) return '151 a 200';
  if (count <= 300) return '201 a 300';
  if (count <= 400) return '301 a 400';
  return '401 a 500';
}

function formatBrazilianPhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  const mobile = subscriber.startsWith('9');
  const firstGroupLength = mobile ? 5 : 4;
  if (!subscriber) return `(${ddd})`;
  if (subscriber.length <= firstGroupLength) return `(${ddd}) ${subscriber}`;
  return `(${ddd}) ${subscriber.slice(0, firstGroupLength)}-${subscriber.slice(firstGroupLength)}`;
}

export function ExpertContactForm() {
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormValues>(() => ({ ...emptyForm, studentsRange: rangeFromCount(searchParams.get('studentCount')) }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    const needsReconciliation = window.sessionStorage.getItem(RECONCILIATION_SESSION_KEY) === 'true';
    setRequiresReconciliation(needsReconciliation);
    if (needsReconciliation) {
      setError('Um envio anterior foi recebido, mas o registro no CRM não pôde ser confirmado. Para evitar duplicidade, não envie o formulário novamente; nossa equipe pode continuar pelo WhatsApp.');
    }
  }, []);

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    if (!requiresReconciliation) requestId.current = null;
    setError(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const stableRequestId = requestId.current ?? crypto.randomUUID();
    requestId.current = stableRequestId;
    try {
      const response = await fetch('/api/public/expert-contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, requestId: stableRequestId }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.message ?? 'Não foi possível enviar seu pedido agora. Confira os dados e tente novamente.');
        if (payload?.error === 'CONTACT_DELIVERY_REQUIRES_RECONCILIATION') {
          window.sessionStorage.setItem(RECONCILIATION_SESSION_KEY, 'true');
          setRequiresReconciliation(true);
        }
        return;
      }
      if (form.website.trim()) {
        setSubmitted(true);
        return;
      }
      setSubmitted(true);
      requestId.current = null;
      window.sessionStorage.removeItem(RECONCILIATION_SESSION_KEY);
    } catch {
      setError('Não foi possível conectar ao servidor. Seus dados continuam preenchidos; tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = 'expert-contact-input mt-1.5 h-11 w-full rounded-lg border-0 bg-[#f2f1f4] px-3.5 text-sm text-[#3d3a3f] outline-none transition focus-visible:ring-4 focus-visible:ring-[#5f3895]/25';
  const selectClass = 'expert-contact-select h-11 w-full appearance-none rounded-lg border-0 bg-[#f2f1f4] pl-3.5 pr-10 text-sm text-[#3d3a3f] outline-none transition focus-visible:ring-4 focus-visible:ring-[#5f3895]/25';
  const labelClass = 'block text-sm font-medium text-[#3d3a3f]';

  return (
    <section className="expert-contact-form-section mx-auto w-full max-w-2xl px-5 pb-12 sm:px-8" aria-labelledby={submitted ? undefined : 'expert-contact-form-title'}>
      <div className="expert-contact-form-card rounded-2xl border border-[rgba(61,58,63,0.18)] bg-white p-5 shadow-sm sm:p-8">
            {submitted ? (
              <div className="expert-contact-confirmation flex flex-col justify-center" role="status" aria-live="polite">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#f1eaf8] text-[#5c2f91]" aria-hidden="true">
                  <CheckIcon className="h-6 w-6" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[#241a31]">Pedido enviado</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
                  Recebemos seu pedido! Em breve, nossa equipe falará com você para conhecer sua escola e mostrar como a Alusa pode ajudar.
                </p>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <h3 id="expert-contact-form-title" className="text-2xl font-normal tracking-tight text-[#3d3a3f]">Como podemos falar com você?</h3>
                </div>

                <div className="grid gap-4">
                  <label className={labelClass}>
                    Nome completo
                    <input className={inputClass} autoComplete="name" required minLength={2} maxLength={120} value={form.contactName} onChange={(event) => update('contactName', event.currentTarget.value)} />
                  </label>
                  <label className={labelClass}>
                    E-mail
                    <input className={inputClass} type="email" autoComplete="email" required maxLength={180} value={form.email} onChange={(event) => update('email', event.currentTarget.value)} />
                  </label>
                  <label className={labelClass}>
                    Escola ou instituição
                    <input className={inputClass} autoComplete="organization" required minLength={2} maxLength={160} value={form.institutionName} onChange={(event) => update('institutionName', event.currentTarget.value)} />
                  </label>
                  <label className={labelClass}>
                    WhatsApp
                    <input className={inputClass} type="tel" autoComplete="tel" inputMode="tel" required minLength={14} maxLength={20} placeholder="(11) 99999-9999" value={form.phone} onChange={(event) => update('phone', formatBrazilianPhone(event.currentTarget.value))} />
                  </label>
                  <label className={labelClass}>
                    Tipo de instituição
                    <span className="relative mt-1.5 block">
                      <select className={selectClass} required value={form.institutionType} onChange={(event) => update('institutionType', event.currentTarget.value)}>
                        <option value="" disabled>Selecione uma opção</option>
                        {EXPERT_CONTACT_INSTITUTION_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6e6873]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </label>
                  <label className={labelClass}>
                    Quantidade estimada de alunos
                    <span className="relative mt-1.5 block">
                      <select className={selectClass} required value={form.studentsRange} onChange={(event) => update('studentsRange', event.currentTarget.value)}>
                        <option value="" disabled>Selecione uma faixa</option>
                        {EXPERT_CONTACT_STUDENT_RANGES.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6e6873]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </label>
                </div>

                <label aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                  Website
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update('website', event.currentTarget.value)} />
                </label>

                <p className="text-xs leading-5 text-slate-500">
                  Seus dados serão usados para atender esta solicitação, conforme a{' '}
                  <Link className="underline underline-offset-2" href="/privacidade">Política de Privacidade</Link>.
                  O atendimento pode ser apoiado pelo HubSpot; consulte a{' '}
                  <Link className="underline underline-offset-2" href="/suboperadores">Política de Suboperadores</Link>.
                </p>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800" role="alert">
                    <p>{error}</p>
                    <a className="mt-2 inline-block font-medium underline underline-offset-2" href={buildWhatsAppUrl(form)} target="_blank" rel="noreferrer">
                      Continuar pelo WhatsApp
                    </a>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-[#eeeaf2] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-sm text-xs leading-5 text-slate-500">
                    Em breve, nossa equipe entrará em contato com você
                    <br className="hidden sm:block" />
                    {' '}para dar continuidade ao atendimento.
                  </p>
                  <button type="submit" disabled={isSubmitting || requiresReconciliation} className="site-pill button-primary expert-contact-submit min-h-11 shrink-0 disabled:cursor-not-allowed disabled:opacity-60">
                    {isSubmitting ? 'Enviando pedido…' : requiresReconciliation ? 'Confirmação em andamento' : 'Solicitar contato'}
                  </button>
                </div>
              </form>
            )}
      </div>
    </section>
  );
}
