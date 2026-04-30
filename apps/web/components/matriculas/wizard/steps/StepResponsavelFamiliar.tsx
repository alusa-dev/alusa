'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Popover from '@radix-ui/react-popover';
import { z } from 'zod';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search as SearchIcon, UserPlus } from '@/components/icons/icons';
import { maskCPF, maskPhone, unmask } from '@/lib/utils/masks';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { WizardContextValue } from '../types';

interface ResponsavelOption {
  id: string;
  nome: string;
  cpf?: string | null;
  email?: string | null;
  telefone?: string | null;
}

const novoResponsavelSchema = z.object({
  nome: z.string().min(2, 'Nome obrigatório'),
  cpf: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  telefone: z.string().optional(),
});
type NovoResponsavelFormData = z.infer<typeof novoResponsavelSchema>;

interface StepResponsavelFamiliarProps {
  ctx: WizardContextValue;
}

export function StepResponsavelFamiliar({ ctx }: StepResponsavelFamiliarProps) {
  const { state, update } = ctx;

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ResponsavelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    reset: resetForm,
  } = useForm<NovoResponsavelFormData>({
    resolver: zodResolver(novoResponsavelSchema),
  });

  const cpfValue = watch('cpf');
  const telefoneValue = watch('telefone');

  useEffect(() => {
    if (cpfValue) setValue('cpf', maskCPF(cpfValue));
  }, [cpfValue, setValue]);

  useEffect(() => {
    if (telefoneValue) setValue('telefone', maskPhone(telefoneValue));
  }, [telefoneValue, setValue]);

  useEffect(() => {
    if (showForm) setOpen(false);
  }, [showForm]);

  const buscarResponsaveis = useCallback((term: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const qp = new URLSearchParams();
        if (term.trim()) qp.set('q', term.trim());
        const res = await fetch(`/api/responsaveis?${qp.toString()}`);
        const json = await res.json();
        const items: unknown[] = json?.items ?? [];
        setOptions(
          items.map((raw) => {
            const r = raw as Record<string, unknown>;
            return {
              id: String(r.id ?? ''),
              nome: String(r.nome ?? ''),
              cpf: typeof r.cpf === 'string' ? r.cpf : null,
              email: typeof r.email === 'string' ? r.email : null,
              telefone: typeof r.telefone === 'string' ? r.telefone : null,
            };
          }),
        );
      } catch {
        // silencioso — não bloquear o fluxo
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (!showForm) buscarResponsaveis(query);
  }, [query, showForm, buscarResponsaveis]);

  const selecionarResponsavel = (opt: ResponsavelOption) => {
    update({ responsavelFamiliar: { id: opt.id, nome: opt.nome }, alunosFamiliares: [] });
    setQuery(opt.nome);
    setOpen(false);
  };

  const onSubmitNovoResponsavel = async (data: NovoResponsavelFormData) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/responsaveis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: data.nome,
          cpf: data.cpf ? unmask(data.cpf) : undefined,
          email: data.email || undefined,
          telefone: data.telefone ? unmask(data.telefone) : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao cadastrar responsável');
      }

      const resp = await res.json();
      update({ responsavelFamiliar: { id: resp.id, nome: resp.nome }, alunosFamiliares: [] });
      setQuery(resp.nome);
      setShowForm(false);
      resetForm();
    } catch (e) {
      const message = (e as Error).message || 'Erro ao cadastrar responsável';
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro"
          description={message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  };

  const selecionado = state.responsavelFamiliar;
  const showDropdown = !showForm && !selecionado && open && query.trim().length > 0;
  const responsavelInitials = useMemo(() => {
    const nome = selecionado?.nome?.trim();
    if (!nome) return 'RF';

    return nome
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('') || 'RF';
  }, [selecionado?.nome]);

  return (
    <SectionCard>
      <StepHeader
        title="Responsável financeiro"
        hint="O responsável será vinculado a todos os alunos desta matrícula familiar."
      />

      {!showForm ? (
        <div className="space-y-3">
          {!selecionado ? (
            <>
              <Popover.Root open={showDropdown} onOpenChange={setOpen}>
                <Popover.Anchor asChild>
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuery(value);
                        if (!open && value.trim()) setOpen(true);
                        if (!value.trim()) setOpen(false);
                      }}
                      onFocus={() => {
                        if (query.trim()) setOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setOpen(false);
                      }}
                      placeholder="Ex.: Maria Silva ou 123.456.789-00"
                      className="flex h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pl-11 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#5c2f91] focus:outline-none focus:ring-2 focus:ring-[#5c2f91]/30 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-autocomplete="list"
                      aria-expanded={showDropdown}
                      aria-controls="responsavel-suggestions"
                      data-testid="responsavel-search"
                    />
                  </div>
                </Popover.Anchor>
                <Popover.Portal>
                  <Popover.Content
                    className="z-[99999] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                    sideOffset={4}
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={(e) => {
                      if (e.target === inputRef.current) return;
                      setOpen(false);
                    }}
                  >
                    <div
                      id="responsavel-suggestions"
                      className="max-h-[calc(4*52px+8px)] overflow-y-auto"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#d1d5db transparent',
                      }}
                    >
                      {loading && (
                        <div className="select-none px-4 py-3 text-sm text-gray-500">
                          Carregando...
                        </div>
                      )}

                      {!loading && options.length === 0 && (
                        <div className="select-none px-4 py-3 text-sm text-gray-500">
                          Nenhum responsável encontrado
                        </div>
                      )}

                      {!loading && options.slice(0, 10).map((opt, index) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => selecionarResponsavel(opt)}
                          className={cn(
                            'w-full cursor-pointer bg-white px-3 py-2.5 text-left text-sm text-gray-900 transition-colors',
                            'hover:bg-gray-50 focus:bg-gray-100 focus:outline-none',
                            index < Math.min(options.length, 10) - 1 && 'border-b border-gray-100',
                          )}
                        >
                          <span className="block font-medium text-gray-900">{opt.nome}</span>
                          {(opt.cpf || opt.email) && (
                            <span className="block text-xs text-gray-500">
                              {[opt.cpf, opt.email].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              <button
                type="button"
                data-testid="responsavel-novo-btn"
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Cadastrar novo responsável
              </button>
            </>
          ) : (
            <div
              data-testid="responsavel-selecionado"
              className="relative flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5c2f91]/15 text-sm font-semibold text-[#5c2f91]">
                {responsavelInitials}
              </div>

              <div className="flex-1 space-y-1 text-sm text-gray-700">
                <p className="text-base font-semibold text-gray-900">{selecionado.nome}</p>
                <p className="text-xs text-gray-600">Selecionado como responsável financeiro</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  update({ responsavelFamiliar: undefined, alunosFamiliares: [] });
                  setQuery('');
                  setOptions([]);
                  setOpen(false);
                  window.requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="text-xs text-violet-600 hover:text-violet-800"
              >
                Trocar
              </button>
            </div>
          )}
        </div>
      ) : (
        <form data-testid="responsavel-form" onSubmit={handleSubmit(onSubmitNovoResponsavel)} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Nome *</label>
            <Input {...register('nome')} placeholder="Nome completo" />
            {errors.nome && <p className="text-[11px] text-red-600">{errors.nome.message}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">CPF</label>
              <Input {...register('cpf')} placeholder="000.000.000-00" maxLength={14} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Telefone</label>
              <Input {...register('telefone')} placeholder="(00) 00000-0000" maxLength={15} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">E-mail</label>
            <Input {...register('email')} type="email" placeholder="email@exemplo.com" />
            {errors.email && <p className="text-[11px] text-red-600">{errors.email.message}</p>}
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Cadastrar'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
