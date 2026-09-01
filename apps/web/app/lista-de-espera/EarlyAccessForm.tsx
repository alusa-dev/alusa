'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldCheck } from '@/components/icons/icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const initialForm = {
  institutionName: '',
  contactName: '',
  role: '',
  email: '',
  phone: '',
  studentsRange: '',
  mainChallenge: '',
  website: '',
  marketingConsent: false,
};

export function EarlyAccessForm() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<FormState>('idle');

  function updateField<Field extends keyof typeof initialForm>(field: Field, value: (typeof initialForm)[Field]) {
    setForm((current) => ({ ...current, [field]: value }));
    if (status === 'error') setStatus('idle');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.marketingConsent || !form.studentsRange) {
      setStatus('error');
      return;
    }

    setStatus('submitting');

    try {
      const response = await fetch('/api/public/early-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) throw new Error('submit_failed');
      setStatus('success');
      setForm(initialForm);
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="early-access-success" role="status">
        <span className="early-access-success-mark" aria-hidden="true">✓</span>
        <h2>Muito obrigado!</h2>
        <p>Em breve, você receberá mais informações sobre a lista de espera da Alusa.</p>
      </div>
    );
  }

  return (
    <form className="early-access-form" onSubmit={handleSubmit}>
      <h2 className="early-access-form-title">Preencha o formulário</h2>
      <div className="early-access-form-divider" aria-hidden="true" />
      <div className="early-access-form-grid">
        <label>
          <span>Nome da instituição</span>
          <input required name="institutionName" value={form.institutionName} onChange={(event) => updateField('institutionName', event.target.value)} placeholder="Ex.: Colégio Horizonte" autoComplete="organization" />
        </label>
        <label>
          <span>Seu nome</span>
          <input required name="contactName" value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} placeholder="Nome e Sobrenome" autoComplete="name" />
        </label>
        <label>
          <span>E-mail</span>
          <input required type="email" name="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="voce@escola.com.br" autoComplete="email" />
        </label>
        <label>
          <span>WhatsApp</span>
          <input required name="phone" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" autoComplete="tel" />
        </label>
        <label>
          <span>Cargo</span>
          <input required name="role" value={form.role} onChange={(event) => updateField('role', event.target.value)} placeholder="Ex.: Direção" autoComplete="organization-title" />
        </label>
        <label>
          <span>Número de alunos</span>
          <Select value={form.studentsRange} onValueChange={(value) => updateField('studentsRange', value)}>
            <SelectTrigger
              aria-label="Número de alunos"
              aria-required="true"
              className="early-access-students-select"
            >
              <SelectValue placeholder="Selecione uma faixa" />
            </SelectTrigger>
            <SelectContent className="early-access-students-content data-[state=open]:animate-none data-[state=closed]:animate-none">
              <SelectItem value="ate-200">Até 200</SelectItem>
              <SelectItem value="201-500">201 a 500</SelectItem>
              <SelectItem value="501-1000">501 a 1.000</SelectItem>
              <SelectItem value="mais-de-1000">Mais de 1.000</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <label className="early-access-full-field">
        <span>Qual é o principal desafio da sua escola hoje?</span>
        <textarea name="mainChallenge" value={form.mainChallenge} onChange={(event) => updateField('mainChallenge', event.target.value)} placeholder="Conte brevemente, se quiser" rows={3} />
      </label>

      <input className="early-access-honeypot" name="website" value={form.website} onChange={(event) => updateField('website', event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />

      {status === 'error' && <p className="early-access-form-error" role="alert">Não foi possível concluir agora. Verifique os dados e tente novamente.</p>}
      <label className="early-access-consent">
        <input
          required
          type="checkbox"
          name="marketingConsent"
          checked={form.marketingConsent}
          onChange={(event) => updateField('marketingConsent', event.target.checked)}
        />
        <span>Aceito receber comunicações promocionais da Alusa.</span>
      </label>
      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Confirmando…' : 'Entrar na lista de espera'}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="early-access-privacy">
        <ShieldCheck aria-hidden="true" />
        <span>Seus dados estão protegidos.</span>
      </p>
    </form>
  );
}
