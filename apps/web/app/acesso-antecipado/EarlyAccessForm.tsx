'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

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
};

export function EarlyAccessForm() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<FormState>('idle');

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (status === 'error') setStatus('idle');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <h2>Cadastro confirmado.</h2>
        <p>Você entrou na lista de acesso antecipado da Alusa. Em breve, falaremos com você.</p>
      </div>
    );
  }

  return (
    <form className="early-access-form" onSubmit={handleSubmit} noValidate>
      <div className="early-access-form-grid">
        <label>
          <span>Nome da instituição</span>
          <input required name="institutionName" value={form.institutionName} onChange={(event) => updateField('institutionName', event.target.value)} placeholder="Ex.: Colégio Horizonte" autoComplete="organization" />
        </label>
        <label>
          <span>Seu nome</span>
          <input required name="contactName" value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} placeholder="Como podemos chamar você?" autoComplete="name" />
        </label>
        <label>
          <span>E-mail</span>
          <input required type="email" name="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="voce@escola.com.br" autoComplete="email" />
        </label>
        <label>
          <span>WhatsApp</span>
          <input name="phone" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" autoComplete="tel" />
        </label>
        <label>
          <span>Cargo</span>
          <input name="role" value={form.role} onChange={(event) => updateField('role', event.target.value)} placeholder="Ex.: Direção" autoComplete="organization-title" />
        </label>
        <label>
          <span>Número de alunos</span>
          <select name="studentsRange" value={form.studentsRange} onChange={(event) => updateField('studentsRange', event.target.value)}>
            <option value="">Selecione uma faixa</option>
            <option value="ate-200">Até 200</option>
            <option value="201-500">201 a 500</option>
            <option value="501-1000">501 a 1.000</option>
            <option value="mais-de-1000">Mais de 1.000</option>
          </select>
        </label>
      </div>

      <label className="early-access-full-field">
        <span>Qual é o principal desafio da sua escola hoje?</span>
        <textarea name="mainChallenge" value={form.mainChallenge} onChange={(event) => updateField('mainChallenge', event.target.value)} placeholder="Conte brevemente, se quiser" rows={3} />
      </label>

      <input className="early-access-honeypot" name="website" value={form.website} onChange={(event) => updateField('website', event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />

      {status === 'error' && <p className="early-access-form-error" role="alert">Não foi possível concluir agora. Verifique os dados e tente novamente.</p>}
      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Confirmando…' : 'Quero acesso antecipado'}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="early-access-privacy">Ao enviar, você autoriza a Alusa a entrar em contato sobre o acesso antecipado.</p>
    </form>
  );
}
