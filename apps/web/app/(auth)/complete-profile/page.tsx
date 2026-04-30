"use client";
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  telefone: z.string().min(8, 'Telefone inválido').max(20).optional().or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

export default function CompleteProfilePage() {
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      // Se telefone foi preenchido, podemos salvar em /api/users/me
      const telefone = values.telefone && values.telefone.trim().length > 0 ? values.telefone : undefined;
      if (telefone) {
        await fetch('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefone }),
        }).catch(() => undefined);
      }
      window.location.href = '/dashboard';
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-[480px] max-w-[92vw] rounded-[40px] bg-white px-12 py-10 shadow-[0_6px_24px_rgba(0,0,0,0.12)] flex flex-col items-center" data-layer="form complete-profile">
      <header className="text-center mb-8 space-y-2">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight">Complete seu perfil</h1>
        <p className="text-[12px] font-medium text-brand-muted">Adicione informações complementares antes de entrar.</p>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(onSubmit)(); }} className="w-full max-w-[360px] flex flex-col gap-5" data-testid="complete-profile-form" noValidate>
        <div>
          <div className="relative h-12">
            <input
              type="text"
              placeholder="Telefone (opcional)"
              className="w-full h-12 rounded-[30px] border border-gray-300 bg-white px-5 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0"
              {...register('telefone')}
              data-testid="complete-telefone"
            />
          </div>
        </div>
        <button type="submit" disabled={saving || isSubmitting} className="mt-1 h-12 rounded-[30px] bg-[#5c2f91] hover:bg-[#4b217a] text-white text-[14px] font-medium flex items-center justify-center transition-colors outline-none disabled:opacity-60" data-testid="complete-submit">
          {saving || isSubmitting ? 'Salvando…' : 'Continuar'}
        </button>
      </form>
    </div>
  );
}
