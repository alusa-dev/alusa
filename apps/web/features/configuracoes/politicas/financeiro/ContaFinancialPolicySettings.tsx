'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CustomToast } from '@/components/ui/toast';
import { useContaFinancialPolicy } from './hooks/useContaFinancialPolicy';
import type { ContaFinancialPolicyDTO } from './dtos';
import {
  buildFinancialPolicyPreview,
  buildFinancialPolicySummary,
  FINANCIAL_POLICY_OVERRIDE_ROLES,
  getPresetLabel,
  normalizeFinancialPolicyConfig,
} from './policy-dependencies';

const presetOptions = [
  {
    value: 'FLEXIVEL',
    label: 'Permitir com alerta',
    description: 'A rematrícula segue com aviso para a equipe quando houver pendência relevante.',
  },
  {
    value: 'CONTROLADA',
    label: 'Exigir autorização',
    description: 'A rematrícula só prossegue com autorização dos perfis definidos.',
  },
  {
    value: 'RESTRITIVA',
    label: 'Bloquear até regularização',
    description: 'A rematrícula fica bloqueada até regularização ou reconciliação financeira.',
  },
] as const;

const debtScopeOptions = [
  { value: 'QUALQUER_COBRANCA_EM_ABERTO', label: 'Qualquer cobrança em aberto' },
  { value: 'APENAS_VENCIDAS', label: 'Apenas cobranças vencidas' },
] as const;

const roleLabels: Record<(typeof FINANCIAL_POLICY_OVERRIDE_ROLES)[number], string> = {
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  RECEPCAO: 'Recepção',
};

function buildInitialForm(policy: ContaFinancialPolicyDTO | null): ContaFinancialPolicyDTO | null {
  if (!policy) return null;
  return {
    ...normalizeFinancialPolicyConfig(
      {
        preset: policy.preset,
        debtScope: policy.debtScope,
        overrideRoles: [...policy.overrideRoles],
      },
      { useDefaultOverrideRoles: true },
    ),
    summary: policy.summary,
    updatedAt: policy.updatedAt,
  };
}

export function ContaFinancialPolicySettings() {
  const { policy, loading, saving, error, fetchPolicy, savePolicy } = useContaFinancialPolicy();
  const [form, setForm] = useState<ContaFinancialPolicyDTO | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setForm(buildInitialForm(policy));
  }, [policy]);

  const currentSummary = useMemo(() => {
    if (form) return buildFinancialPolicySummary(form);
    return policy?.summary ?? 'Configure como a escola trata pendências na rematrícula.';
  }, [form, policy]);

  const livePreview = useMemo(() => {
    if (!form) return '';
    return buildFinancialPolicyPreview(form);
  }, [form]);

  const activePreset = form?.preset ?? policy?.preset;
  const activeDebtScope = form?.debtScope ?? policy?.debtScope;
  const selectedPresetOption = presetOptions.find((option) => option.value === activePreset) ?? null;
  const selectedDebtScopeOption = debtScopeOptions.find((option) => option.value === activeDebtScope) ?? null;

  const requiresApproval = form?.preset === 'CONTROLADA';
  const canSubmit =
    Boolean(form) &&
    (!requiresApproval || (form?.overrideRoles.length ?? 0) > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;

    try {
      await savePolicy({
        preset: form.preset,
        debtScope: form.debtScope,
        overrideRoles: form.overrideRoles,
      });

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Regra atualizada"
          description="A regra financeira da rematrícula foi salva com sucesso."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (err) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Falha ao salvar"
          description={err instanceof Error ? err.message : 'Erro inesperado.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-6 px-6 py-5 text-left sm:px-7 sm:py-5"
        onClick={() => setExpanded((current) => !current)}
        data-testid="policy-section-rematricula-trigger"
      >
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-600 alusa-dark:text-[color:var(--color-text-brand)]">Rematrícula</p>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Regra financeira da rematrícula</h3>
            <p className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{currentSummary}</p>
          </div>
        </div>
        <span className="mt-1 shrink-0 text-sm font-medium text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">{expanded ? 'Recolher' : 'Expandir'}</span>
      </button>

      {expanded ? (
        <div className="border-t border-gray-100 bg-slate-50/40 px-6 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:rgba(255,255,255,0.02)] sm:px-7 sm:py-6">
          {error ? (
            <Alert variant="destructive" className="mb-6">
              <AlertTitle>Falha ao carregar a regra</AlertTitle>
              <AlertDescription className="mt-1 flex items-center gap-3">
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={fetchPolicy}>
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] sm:p-5">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Como a escola trata pendências na rematrícula</h4>
                <p className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                  Esta regra define o que acontece quando ainda existem pendências financeiras da matrícula anterior.
                </p>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {presetOptions.map((option) => {
                  const active = form?.preset === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      data-testid={`financial-policy-preset-${option.value.toLowerCase()}`}
                      disabled={loading || saving || !form}
                      onClick={() =>
                        setForm((current) =>
                          current
                            ? {
                                ...current,
                                ...normalizeFinancialPolicyConfig({
                                  preset: option.value,
                                  debtScope: current.debtScope,
                                  overrideRoles: current.overrideRoles,
                                }),
                              }
                            : current,
                        )
                      }
                      className={`h-full rounded-2xl border px-4 py-4 text-left transition ${
                        active
                          ? 'border-violet-300 bg-violet-50 shadow-[0_10px_30px_rgba(124,58,237,0.08)] alusa-dark:border-[color:var(--color-border-brand)] alusa-dark:bg-[color:rgba(169,77,255,0.14)] alusa-dark:shadow-none'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-slate-50/70 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:hover:border-[color:var(--color-border-strong)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)]'
                      }`}
                    >
                      <div className="flex h-full min-h-[120px] flex-col justify-between gap-3">
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{option.label}</p>
                          <p className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{option.description}</p>
                        </div>
                        <span
                          className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                            active
                              ? 'bg-white text-violet-700 alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-brand)]'
                              : 'bg-slate-100 text-gray-500 alusa-dark:bg-[color:rgba(255,255,255,0.05)] alusa-dark:text-[color:var(--color-text-muted)]'
                          }`}
                        >
                          {active ? 'Selecionado' : 'Disponível'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
              <div className="space-y-6">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] sm:p-5">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">O que conta como pendência relevante</Label>
                    <p className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                      Escolha se a rematrícula considera qualquer cobrança em aberto ou somente títulos vencidos.
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    <Select
                      value={form?.debtScope}
                      disabled={loading || saving || !form}
                      onValueChange={(value) =>
                        setForm((current) =>
                          current
                            ? {
                                ...current,
                                debtScope: value as ContaFinancialPolicyDTO['debtScope'],
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger data-testid="financial-policy-scope-trigger" className="bg-white alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)]">
                        <SelectValue placeholder="Selecione o critério" />
                      </SelectTrigger>
                      <SelectContent>
                        {debtScopeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <p className="text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                      {form?.debtScope === 'APENAS_VENCIDAS'
                        ? 'A escola só considera cobranças vencidas para decidir a rematrícula.'
                        : 'A escola considera cobranças futuras, pendentes e vencidas para decidir a rematrícula.'}
                    </p>
                  </div>
                </section>

                {requiresApproval ? (
                  <section className="rounded-2xl border border-gray-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] sm:p-5">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Quem pode autorizar exceções</h4>
                      <p className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                        Somente estes perfis poderão aprovar a rematrícula quando a regra exigir autorização.
                      </p>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {FINANCIAL_POLICY_OVERRIDE_ROLES.map((role) => {
                        const checked = Boolean(form?.overrideRoles.includes(role));
                        return (
                          <label
                            key={role}
                            className="flex min-h-[52px] items-center gap-3 rounded-xl border border-gray-200 bg-slate-50/70 px-4 py-3 text-sm text-gray-700 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={loading || saving || !form}
                              data-testid={`financial-policy-override-role-${role.toLowerCase()}`}
                              onCheckedChange={(next) =>
                                setForm((current) => {
                                  if (!current) return current;
                                  const overrideRoles = next
                                    ? Array.from(new Set([...current.overrideRoles, role]))
                                    : current.overrideRoles.filter((entry) => entry !== role);
                                  return {
                                    ...current,
                                    overrideRoles,
                                  };
                                })
                              }
                            />
                            <span className="font-medium text-gray-800 alusa-dark:text-[color:var(--color-text-primary)]">{roleLabels[role]}</span>
                          </label>
                        );
                      })}
                    </div>

                    <p className="mt-4 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                      O motivo da autorização será sempre obrigatório para manter rastreabilidade da decisão.
                    </p>
                  </section>
                ) : null}
              </div>

              <aside className="self-start xl:sticky xl:top-6">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)] alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:shadow-none sm:p-6">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Resumo atual da regra</p>
                    <p data-testid="financial-policy-live-summary" className="text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                      {currentSummary}
                    </p>
                  </div>

                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl border border-gray-200 bg-slate-50/80 px-4 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Tratamento</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{selectedPresetOption?.label ?? '-'}</p>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-slate-50/80 px-4 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">Pendência considerada</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{selectedDebtScopeOption?.label ?? '-'}</p>
                    </div>
                  </div>

                  <p className="mt-5 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">{livePreview}</p>

                  {!canSubmit ? (
                    <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 alusa-dark:border-red-500/30 alusa-dark:bg-red-500/10 alusa-dark:text-red-200">
                      Selecione pelo menos um perfil autorizador para usar a regra “{getPresetLabel('CONTROLADA')}”.
                    </p>
                  ) : null}

                  <div className="mt-6 flex justify-end">
                    <Button type="submit" disabled={loading || saving || !canSubmit} className="w-full sm:w-auto">
                      {saving ? 'Salvando...' : 'Salvar regra'}
                    </Button>
                  </div>
                </section>
              </aside>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
