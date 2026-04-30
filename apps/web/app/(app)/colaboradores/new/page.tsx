'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// Import direto do source até a lib ser buildada/exportar tipos
import {
  colaboradorSchema,
  type ColaboradorInput,
} from '../../../../../../packages/lib/src/schemas/colaborador';
import cepPromise from 'cep-promise';
import { useSession } from 'next-auth/react';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const mask = {
  cpf: (v: string) =>
    v
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
      .slice(0, 14),
  tel: (v: string) =>
    v
      .replace(/\D/g, '')
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 15),
  cep: (v: string) =>
    v
      .replace(/\D/g, '')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 9),
};

export default function NovoColaboradorPage() {
  const [step, setStep] = useState<Step>(1);
  const schema = useMemo(() => colaboradorSchema, []);
  const form = useForm<ColaboradorInput>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      cargo: 'RECEPCAO',
      status: 'ATIVO',
      temAcesso: false,
    } as Partial<ColaboradorInput>,
  });
  const cargo = form.watch('cargo');
  const status = form.watch('status');
  const { data: session } = useSession();
  const effectiveContaId =
    (session?.user as { contaId?: string } | undefined)?.contaId || 'conta-default';

  const onSubmit = form.handleSubmit(async (values) => {
    const qs = new URLSearchParams({ contaId: effectiveContaId }).toString();
    const res = await fetch(`/api/colaboradores?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      window.location.href = '/colaboradores';
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data?.error || 'Falha ao salvar');
    }
  });

  return (
    <div className="space-y-6" data-testid="colaborador-wizard">
      <div className="space-y-1">
        <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
          Novo colaborador
        </h1>
        <p className="text-[13px] text-gray-500">
          Wizard em etapas para cadastrar professores, recepção e demais funções.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-0 text-gray-900 overflow-hidden">
        {/* Cabeçalho com passos simples */}
        <div className="flex gap-1 border-b bg-gray-50/60 px-3 py-2 text-xs">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStep(n as Step)}
              className={[
                'px-2 py-1 rounded',
                step === n ? 'bg-brand/10 text-brand-700' : 'hover:bg-gray-100',
              ].join(' ')}
            >
              Passo {n}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-6">
          {step === 1 && (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium mb-1">Nome</label>
                <input
                  {...form.register('nome')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  placeholder="Nome completo"
                />
                {form.formState.errors.nome && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.nome.message as string}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">CPF</label>
                <input
                  {...form.register('cpf')}
                  onChange={(e) =>
                    form.setValue('cpf', mask.cpf(e.target.value), { shouldValidate: true })
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  placeholder="000.000.000-00"
                />
                {form.formState.errors.cpf && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.cpf.message as string}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Cargo</label>
                <Select
                  value={cargo}
                  onValueChange={(v: ColaboradorInput['cargo']) => form.setValue('cargo', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROFESSOR">Professor</SelectItem>
                    <SelectItem value="RECEPCAO">Recepção</SelectItem>
                    <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                    <SelectItem value="ADMINISTRATIVO">Administrativo</SelectItem>
                    <SelectItem value="OUTRO">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">E-mail</label>
                <input
                  {...form.register('email')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  placeholder="seu@email.com"
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.email.message as string}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Telefone 1</label>
                <input
                  {...form.register('telefone1')}
                  onChange={(e) =>
                    form.setValue('telefone1', mask.tel(e.target.value), { shouldValidate: true })
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  placeholder="(11) 99999-9999"
                />
                {form.formState.errors.telefone1 && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.telefone1.message as string}
                  </p>
                )}
              </div>
              {/* Telefone 2 removido do fluxo */}
            </section>
          )}

          {step === 3 && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">CEP</label>
                <div className="flex gap-2">
                  <input
                    {...form.register('enderecoCep')}
                    onChange={(e) =>
                      form.setValue('enderecoCep', mask.cep(e.target.value), {
                        shouldValidate: true,
                      })
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                    placeholder="00000-000"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const cep = (form.getValues('enderecoCep') || '').replace(/\D/g, '');
                      if (cep?.length !== 8) return;
                      try {
                        const r = await cepPromise(cep);
                        form.setValue('enderecoLogradouro', r.street || '');
                        form.setValue('enderecoBairro', r.neighborhood || '');
                        form.setValue('enderecoCidade', r.city || '');
                        form.setValue('enderecoUf', (r.state || '').slice(0, 2));
                      } catch {
                        // ignora erros de CEP
                      }
                    }}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    Buscar
                  </button>
                </div>
                {form.formState.errors.enderecoCep && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.enderecoCep.message as string}
                  </p>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Logradouro</label>
                <input
                  {...form.register('enderecoLogradouro')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Número</label>
                <input
                  {...form.register('enderecoNumero')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Complemento</label>
                <input
                  {...form.register('enderecoComplemento')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Bairro</label>
                <input
                  {...form.register('enderecoBairro')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Cidade</label>
                <input
                  {...form.register('enderecoCidade')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">UF</label>
                <input
                  {...form.register('enderecoUf')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  placeholder="SP"
                  maxLength={2}
                />
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <Select
                  value={status}
                  onValueChange={(v: ColaboradorInput['status']) => form.setValue('status', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATIVO">Ativo</SelectItem>
                    <SelectItem value="INATIVO">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data de admissão</label>
                <input
                  type="date"
                  {...form.register('dataAdmissao', { valueAsDate: true })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data de desligamento</label>
                <input
                  type="date"
                  {...form.register('dataDesligamento', { valueAsDate: true })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                />
                {form.formState.errors.dataDesligamento && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.dataDesligamento.message as string}
                  </p>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Observações</label>
                <textarea
                  {...form.register('observacoes')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                  rows={3}
                />
              </div>
            </section>
          )}

          {step === 5 && (
            <section className="space-y-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register('temAcesso')} />
                Conceder acesso ao sistema
              </label>
              <p className="text-xs text-gray-500">Se marcado, o e-mail se torna obrigatório.</p>
            </section>
          )}

          {step === 6 && (
            <section>
              <p className="text-sm text-gray-600">
                Revisão rápida. Clique em salvar quando estiver pronto.
              </p>
              <pre className="mt-3 rounded bg-gray-50 p-3 text-xs overflow-auto">
                {JSON.stringify(form.watch(), null, 2)}
              </pre>
            </section>
          )}

          <div className="flex items-center justify-between pt-4 border-t">
            <Link className="text-brand-accent hover:underline text-sm" href="/colaboradores">
              Cancelar
            </Link>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={step === 1}
                onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
                className="px-3 py-2 rounded-md border text-sm"
              >
                Voltar
              </button>
              {step < 6 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(6, s + 1) as Step)}
                  className="px-3 py-2 rounded-md bg-[#A94DFF] text-white text-sm hover:bg-[#A94DFF]/90"
                >
                  Avançar
                </button>
              ) : (
                <button
                  type="submit"
                  className="px-3 py-2 rounded-md bg-brand-600 text-white text-sm"
                >
                  Salvar
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
