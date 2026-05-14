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
  createPlanoRequest,
  updatePlanoRequest,
  type PlanoListItem,
} from '@/features/cadastro/planos/services/planos-service';
import { CustomToast } from '@/components/ui/toast';
import { toast } from '@/components/ui/toast';

export interface PlanoDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  contaId: string;
  plano?: PlanoListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: (_plano: PlanoListItem) => void;
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

export function PlanoDialog({
  open,
  mode,
  contaId,
  plano,
  onOpenChange,
  onSuccess,
}: PlanoDialogProps) {
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

      let saved: PlanoListItem;
      if (mode === 'edit') {
        if (!plano) throw new Error('Plano não encontrado para edição.');
        saved = await updatePlanoRequest({
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
        saved = await createPlanoRequest({
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
        className="w-full max-w-xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0"
      >
        <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-5 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
            {mode === 'edit' ? 'Editar plano' : 'Novo plano'}
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-2xl text-sm text-slate-600">
            {mode === 'edit'
              ? 'Atualize os dados do plano.'
              : 'Cadastre um novo plano de cobrança.'}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto scroll-smooth px-4 py-6 max-md:min-h-0 md:px-6">
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Dados do plano</h3>
              <p className="text-xs text-slate-500">Informe nome, valor e periodicidade.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600" htmlFor="plano-nome">
                  Nome
                </label>
                <Input
                  id="plano-nome"
                  value={values.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="Ex.: Plano Mensal"
                  className={`h-11 rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 focus:border-[#A94DFF] border-slate-200 md:h-10 ${
                    errors.nome
                      ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                      : ''
                  }`}
                />
                {errors.nome ? (
                  <p className="text-[11px] font-medium text-[#DC2626]">{errors.nome}</p>
                ) : null}
              </div>
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600" htmlFor="plano-descricao">
                  Descrição
                </label>
                <Textarea
                  id="plano-descricao"
                  value={values.descricao}
                  onChange={(e) => handleChange('descricao', e.target.value)}
                  rows={3}
                  placeholder="Descrição breve do plano"
                  className={`rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 focus:border-[#A94DFF] border-slate-200 resize-none ${
                    errors.descricao
                      ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                      : ''
                  }`}
                />
                {errors.descricao ? (
                  <p className="text-[11px] font-medium text-[#DC2626]">{errors.descricao}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Periodicidade</label>
                <Select
                  value={values.periodicidade}
                  onValueChange={(val) => handleChange('periodicidade', val)}
                >
                  <SelectTrigger className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm data-[placeholder]:text-slate-400 focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10">
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
                  <p className="text-[11px] font-medium text-[#DC2626]">{errors.periodicidade}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600" htmlFor="plano-valor">
                  Valor (R$)
                </label>
                <Input
                  id="plano-valor"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={values.valor}
                  onChange={(e) => handleChange('valor', e.target.value)}
                  className={`h-11 rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 focus:border-[#A94DFF] border-slate-200 md:h-10 ${
                    errors.valor
                      ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                      : ''
                  }`}
                />
                {errors.valor ? (
                  <p className="text-[11px] font-medium text-[#DC2626]">{errors.valor}</p>
                ) : null}
              </div>
              {mode === 'edit' ? (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Status</label>
                  <Select
                    value={values.status}
                    onValueChange={(val) => handleChange('status', val as PlanoStatus)}
                  >
                    <SelectTrigger className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm data-[placeholder]:text-slate-400 focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10">
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
          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="h-11 min-h-11 w-full border-slate-200 text-slate-600 hover:bg-slate-100 md:h-10 md:min-h-0 md:min-w-[120px] md:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:min-w-[136px] md:w-auto"
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

// preview de valor removido conforme solicitação

export default PlanoDialog;
