'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  wizardFieldInputClass,
  wizardTextareaFieldClass,
} from '@/components/shared/wizard/field-styles';
import type {
  BundleListItem,
  BundleBillingPeriod,
  BundleStatus,
  CreateBundleInput,
  UpdateBundleInput,
} from '../services/bundles-service';
import { useClasses } from '@/features/classes/hooks/use-classes';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  contaId: string;
  combo: BundleListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_data: CreateBundleInput | UpdateBundleInput) => Promise<void>;
}

type FormState = {
  nome: string;
  descricao: string;
  valor: string;
  periodicidade: BundleBillingPeriod;
  status: BundleStatus;
  vagasLimite: string;
  turmaIds: string[];
};

const defaults: FormState = {
  nome: '',
  descricao: '',
  valor: '',
  periodicidade: 'MENSAL',
  status: 'ATIVO',
  vagasLimite: '',
  turmaIds: [],
};

const inputClass = wizardFieldInputClass;
const selectTriggerClass = cn(
  inputClass,
  'alusa-select-trigger flex items-center justify-between gap-2 text-left',
);
const sectionClass =
  'alusa-session-panel space-y-3 rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]';
const labelClass =
  'block text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

export function BundleDialog({ open, mode, contaId, combo, onOpenChange, onSubmit }: Props) {
  const [values, setValues] = useState<FormState>(defaults);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && combo) {
        setValues({
          nome: combo.nome,
          descricao: combo.descricao ?? '',
          valor: combo.valor.toFixed(2),
          periodicidade: combo.periodicidade,
          status: combo.status,
          vagasLimite: combo.vagasLimite == null ? '' : String(combo.vagasLimite),
          turmaIds: combo.turmas.map((t) => t.id),
        });
      } else {
        setValues(defaults);
      }
      setSubmitting(false);
      setErrors({});
    } else {
      setValues(defaults);
    }
  }, [open, mode, combo]);

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: undefined }));
  }

  function parseNumber(str: string): number | null {
    if (!str.trim()) return null;
    const normalized = str.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (values.nome.trim().length < 2) next.nome = 'Informe o nome.';
    const vm = parseNumber(values.valor);
    if (vm == null || vm <= 0) next.valor = 'Valor do ciclo deve ser maior que zero';
    if (values.vagasLimite) {
      const v = Number(values.vagasLimite);
      if (!Number.isInteger(v) || v <= 0) next.vagasLimite = 'Vagas inválidas';
    }
    setErrors(next);
    return Object.keys(next).every((k) => !next[k as keyof FormState]);
  }

  const { items: turmas, loading: turmasLoading } = useClasses({ contaId });

  function formatCurrencyInput(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    const intVal = parseInt(digits, 10);
    const valor = (intVal / 100).toFixed(2).replace('.', ',');
    return valor;
  }

  function toggleTurma(id: string) {
    setValues((prev) => {
      const exists = prev.turmaIds.includes(id);
      return {
        ...prev,
        turmaIds: exists ? prev.turmaIds.filter((t) => t !== id) : [...prev.turmaIds, id],
      };
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payloadBase = {
        contaId,
        nome: values.nome.trim(),
        descricao: values.descricao.trim() || undefined,
        valor: parseNumber(values.valor)!,
        periodicidade: values.periodicidade,
        vagasLimite: values.vagasLimite ? Number(values.vagasLimite) : undefined,
        turmaIds: values.turmaIds,
      };
      if (mode === 'edit' && combo) {
        await onSubmit({ id: combo.id, ...payloadBase });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Combo atualizado"
            description="As alterações foram salvas."
            onClose={() => toast.dismiss(t)}
          />
        ));
      } else {
        await onSubmit(payloadBase);
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Combo criado"
            description="O combo foi cadastrado."
            onClose={() => toast.dismiss(t)}
          />
        ));
      }
      onOpenChange(false);
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao salvar"
          description={(e as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent
        fullScreenMobile
        disableBackdropBlur
        overlayClass="alusa-registration-wizard-overlay"
        className="bundle-registration-dialog alusa-wizard-corner-smoothing flex w-full max-w-3xl min-h-0 flex-col gap-0 overflow-hidden rounded-2xl bg-[#f8fafc] p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[90vh]"
      >
        <div className="relative shrink-0 bg-[#f8fafc] px-4 py-4 alusa-dark:bg-[color:var(--color-bg-card)] max-md:pb-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
            {mode === 'edit' ? 'Editar combo' : 'Novo combo'}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            {mode === 'edit' ? 'Atualize os dados do combo.' : 'Cadastre um novo combo de turmas.'}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="alusa-wizard-fields flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth bg-[#f8fafc] px-4 py-4 max-md:min-h-0 alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5">
            <section className={sectionClass}>
              <header>
                <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                  Dados principais
                </h3>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="combo-nome">
                    Nome
                  </label>
                  <Input
                    id="combo-nome"
                    value={values.nome}
                    placeholder="Ex.: Combo Básico"
                    className={cn(inputClass, errors.nome && 'wizard-field-input--error')}
                    onChange={(e) => setField('nome', e.target.value)}
                  />
                  {errors.nome ? <p className={errorClass}>{errors.nome}</p> : null}
                </div>
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="combo-descricao">
                    Descrição
                  </label>
                  <Textarea
                    id="combo-descricao"
                    rows={3}
                    value={values.descricao}
                    placeholder="Descrição (opcional)"
                    className={cn(wizardTextareaFieldClass, 'resize-none')}
                    onChange={(e) => setField('descricao', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="combo-valor">
                    Valor do ciclo (R$)
                  </label>
                  <Input
                    id="combo-valor"
                    value={values.valor}
                    placeholder="0,00"
                    inputMode="numeric"
                    className={cn(inputClass, errors.valor && 'wizard-field-input--error')}
                    onChange={(e) => setField('valor', formatCurrencyInput(e.target.value))}
                  />
                  {errors.valor ? <p className={errorClass}>{errors.valor}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Periodicidade</label>
                  <Select
                    value={values.periodicidade}
                    onValueChange={(v: BundleBillingPeriod) => setField('periodicidade', v)}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SEMANAL">Semanal</SelectItem>
                      <SelectItem value="QUINZENAL">Quinzenal</SelectItem>
                      <SelectItem value="MENSAL">Mensal</SelectItem>
                      <SelectItem value="TRIMESTRAL">Trimestral</SelectItem>
                      <SelectItem value="ANUAL">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="combo-vagas-limite">
                    Vagas limite
                  </label>
                  <Input
                    id="combo-vagas-limite"
                    value={values.vagasLimite}
                    onChange={(e) => setField('vagasLimite', e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex.: 30"
                    inputMode="numeric"
                    className={cn(inputClass, errors.vagasLimite && 'wizard-field-input--error')}
                  />
                  {errors.vagasLimite ? <p className={errorClass}>{errors.vagasLimite}</p> : null}
                </div>
                {mode === 'edit' ? (
                  <div className="flex flex-col gap-1">
                    <label className={labelClass}>Status</label>
                    <Select
                      value={values.status}
                      onValueChange={(v: BundleStatus) => setField('status', v)}
                    >
                      <SelectTrigger className={selectTriggerClass}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ATIVO">Ativo</SelectItem>
                        <SelectItem value="INATIVO">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </section>
            <section className={sectionClass}>
              <header>
                <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                  Turmas
                </h3>
              </header>
              <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pr-1">
                {turmasLoading ? (
                  <p className="text-xs text-slate-500">Carregando turmas...</p>
                ) : null}
                {!turmasLoading && turmas.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhuma turma disponível.</p>
                ) : null}
                {!turmasLoading
                  ? turmas.map((t) => {
                      const checked = values.turmaIds.includes(t.id);
                      const modalidadeNome = (t as { modalidadeNome?: string }).modalidadeNome;
                      return (
                        <label
                          key={t.id}
                          className="flex cursor-pointer items-start gap-2 rounded-[10px] border border-transparent bg-[#eff3f8] px-3 py-2 text-xs transition-colors hover:bg-[#e7edf5] alusa-dark:bg-[color:var(--color-bg-elevated)]"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#512a82] focus:ring-[#512a82]"
                            checked={checked}
                            onChange={() => toggleTurma(t.id)}
                          />
                          <span className="flex-1">
                            <span className="block font-medium text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">
                              {t.nome}
                            </span>
                            {modalidadeNome ? (
                              <span className="block text-[10px] text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                                {modalidadeNome}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })
                  : null}
              </div>
            </section>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-3 bg-[#f8fafc] p-4 alusa-dark:bg-[color:var(--color-bg-card)] md:flex-row md:items-center md:justify-end md:px-6 md:py-4">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              className="h-11 min-h-11 w-full rounded-[10px] border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50 md:h-10 md:min-h-0 md:min-w-[120px] md:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className="h-11 min-h-11 w-full rounded-[10px] bg-[#512a82] text-white shadow-none hover:bg-[#45236f] md:h-10 md:min-h-0 md:min-w-[136px] md:w-auto"
            >
              {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar combo'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BundleDialog;
