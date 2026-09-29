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
import { planoFormSchema, type PlanoFormOutput, type PlanoStatus } from '@alusa/lib/client';
import {
  createPlanRequest,
  updatePlanRequest,
  type PlanListItem,
} from '@/features/plans/services/plans-service';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  wizardFieldInputClass,
  wizardTextareaFieldClass,
} from '@/components/shared/wizard/field-styles';

export interface PlanDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  contaId: string;
  plano?: PlanListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: (_plano: PlanListItem) => void;
}

type FormState = {
  nome: string;
  descricao: string;
  periodicidade: string; // usaremos lista controlada; alinhar com enum runtime atualizado
  valor: string; // string para facilitar digitação; converter ao salvar
  status?: PlanoStatus; // somente usado em modo edição
};

const defaultState: FormState = {
  nome: '',
  descricao: '',
  periodicidade: 'MENSAL',
  valor: '',
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

export function PlanDialog({
  open,
  mode,
  contaId,
  plano,
  onOpenChange,
  onSuccess,
}: PlanDialogProps) {
  const [values, setValues] = useState<FormState>(defaultState);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && plano) {
        setValues({
          nome: plano.nome,
          descricao: plano.descricao ?? '',
          periodicidade: plano.periodicidade,
          valor: plano.valor.toFixed(2),
          status: plano.status,
        });
      } else {
        setValues(defaultState);
      }
      setErrors({});
      setSubmitting(false);
    } else {
      setValues(defaultState);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, mode, plano]);

  function handleChange<K extends keyof FormState>(field: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    const parsed = planoFormSchema.safeParse({
      ...values,
      valor: values.valor,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key && typeof key === 'string') {
          next[key as keyof FormState] = issue.message;
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      // Converter valor para number usando replace vírgula
      const valorNumber = Number(String(values.valor).replace(',', '.'));
      const payload: PlanoFormOutput = {
        nome: values.nome.trim(),
        descricao: values.descricao.trim(),
        periodicidade: values.periodicidade,
        valor: valorNumber,
      } as PlanoFormOutput;

      let saved: PlanListItem;
      if (mode === 'edit') {
        if (!plano) throw new Error('Plano não encontrado para edição.');
        saved = await updatePlanRequest({
          id: plano.id,
          contaId,
          nome: payload.nome,
          descricao: payload.descricao,
          periodicidade: payload.periodicidade,
          valor: payload.valor,
          status: values.status, // pode estar indefinido (não envia)
        });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Plano atualizado"
            description="As alterações foram salvas."
            onClose={() => toast.dismiss(t)}
          />
        ));
      } else {
        saved = await createPlanRequest({
          contaId,
          nome: payload.nome,
          descricao: payload.descricao,
          periodicidade: payload.periodicidade,
          valor: payload.valor,
        });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Plano criado"
            description="O plano foi registrado."
            onClose={() => toast.dismiss(t)}
          />
        ));
      }
      onSuccess?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao salvar"
          description={(err as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  const periodicidadeOptions = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent
        fullScreenMobile
        overlayClass="alusa-registration-wizard-overlay"
        className="plan-registration-dialog alusa-wizard-corner-smoothing flex w-full max-w-xl min-h-0 flex-col gap-0 overflow-hidden rounded-2xl bg-[#f8fafc] p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[90vh]"
      >
        <div className="relative shrink-0 bg-[#f8fafc] px-4 py-4 alusa-dark:bg-[color:var(--color-bg-card)] max-md:pb-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
            {mode === 'edit' ? 'Editar plano' : 'Novo plano'}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            {mode === 'edit'
              ? 'Atualize os dados do plano.'
              : 'Cadastre um novo plano de cobrança.'}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="alusa-wizard-fields flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth bg-[#f8fafc] px-4 py-4 max-md:min-h-0 alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5">
            <section className={sectionClass}>
              <header>
                <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                  Dados do plano
                </h3>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="plano-nome">
                    Nome
                  </label>
                  <Input
                    id="plano-nome"
                    value={values.nome}
                    onChange={(e) => handleChange('nome', e.target.value)}
                    placeholder="Ex.: Plano Mensal"
                    className={cn(inputClass, errors.nome && 'wizard-field-input--error')}
                  />
                  {errors.nome ? <p className={errorClass}>{errors.nome}</p> : null}
                </div>
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="plano-descricao">
                    Descrição
                  </label>
                  <Textarea
                    id="plano-descricao"
                    value={values.descricao}
                    onChange={(e) => handleChange('descricao', e.target.value)}
                    rows={3}
                    placeholder="Descrição breve do plano"
                    className={cn(
                      wizardTextareaFieldClass,
                      'resize-none',
                      errors.descricao && 'wizard-field-input--error',
                    )}
                  />
                  {errors.descricao ? <p className={errorClass}>{errors.descricao}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Periodicidade</label>
                  <Select
                    value={values.periodicidade}
                    onValueChange={(val) => handleChange('periodicidade', val)}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {periodicidadeOptions.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {formatPeriodicidade(opt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.periodicidade ? (
                    <p className={errorClass}>{errors.periodicidade}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="plano-valor">
                    Valor (R$)
                  </label>
                  <Input
                    id="plano-valor"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={values.valor}
                    onChange={(e) => handleChange('valor', e.target.value)}
                    className={cn(inputClass, errors.valor && 'wizard-field-input--error')}
                  />
                  {errors.valor ? <p className={errorClass}>{errors.valor}</p> : null}
                </div>
                {mode === 'edit' ? (
                  <div className="flex flex-col gap-1">
                    <label className={labelClass}>Status</label>
                    <Select
                      value={values.status}
                      onValueChange={(val) => handleChange('status', val as PlanoStatus)}
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
              {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar plano'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatPeriodicidade(value: string) {
  switch (value) {
    case 'SEMANAL':
      return 'Semanal';
    case 'QUINZENAL':
      return 'Quinzenal';
    case 'MENSAL':
      return 'Mensal';
    case 'TRIMESTRAL':
      return 'Trimestral';
    case 'ANUAL':
      return 'Anual';
    default:
      return value;
  }
}

export default PlanDialog;
