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
import type {
  ComboListItem,
  ComboPeriodicidade,
  ComboStatus,
  CreateComboInput,
  UpdateComboInput,
} from '../services/combos-service';
import { useTurmas } from '../../turmas/hooks/use-turmas';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  contaId: string;
  combo: ComboListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_data: CreateComboInput | UpdateComboInput) => Promise<void>;
}

type FormState = {
  nome: string;
  descricao: string;
  valor: string;
  periodicidade: ComboPeriodicidade;
  status: ComboStatus;
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

export function ComboDialog({ open, mode, contaId, combo, onOpenChange, onSubmit }: Props) {
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

  const { items: turmas, loading: turmasLoading } = useTurmas({ contaId });

  // estilos consistentes para inputs (mesma linguagem visual do SelectTrigger)
  const baseInputCls =
    'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5c2f91]/40 focus:border-[#5c2f91]';
  const textAreaCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5c2f91]/40 focus:border-[#5c2f91]';

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
      <DialogContent className="w-full max-w-3xl overflow-hidden p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">
            {mode === 'edit' ? 'Editar combo' : 'Novo combo'}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-600">
            {mode === 'edit' ? 'Atualize os dados do combo.' : 'Cadastre um novo combo de turmas.'}
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-6 px-6 py-6 max-h-[70vh] overflow-y-auto">
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Dados principais</h3>
              <p className="text-xs text-slate-500">Nome, descrição e valores.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600" htmlFor="combo-nome">
                  Nome
                </label>
                <Input
                  id="combo-nome"
                  value={values.nome}
                  placeholder="Ex.: Combo Básico"
                  className={baseInputCls}
                  onChange={(e) => setField('nome', e.target.value)}
                />
                {errors.nome && (
                  <p className="text-[11px] font-medium text-red-600">{errors.nome}</p>
                )}
              </div>
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600" htmlFor="combo-descricao">
                  Descrição
                </label>
                <Textarea
                  id="combo-descricao"
                  rows={3}
                  value={values.descricao}
                  placeholder="Descrição (opcional)"
                  className={textAreaCls}
                  onChange={(e) => setField('descricao', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Valor do ciclo (R$)</label>
                <Input
                  value={values.valor}
                  placeholder="0,00"
                  inputMode="numeric"
                  className={baseInputCls}
                  onChange={(e) => setField('valor', formatCurrencyInput(e.target.value))}
                />
                {errors.valor && (
                  <p className="text-[11px] font-medium text-red-600">{errors.valor}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Periodicidade</label>
                <Select
                  value={values.periodicidade}
                  onValueChange={(v: ComboPeriodicidade) => setField('periodicidade', v)}
                >
                  <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
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
                <label className="text-xs font-medium text-slate-600">Vagas limite</label>
                <Input
                  value={values.vagasLimite}
                  onChange={(e) => setField('vagasLimite', e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex.: 30"
                  inputMode="numeric"
                  className={baseInputCls}
                />
                {errors.vagasLimite && (
                  <p className="text-[11px] font-medium text-red-600">{errors.vagasLimite}</p>
                )}
              </div>
              {mode === 'edit' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Status</label>
                  <Select
                    value={values.status}
                    onValueChange={(v: ComboStatus) => setField('status', v)}
                  >
                    <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ATIVO">Ativo</SelectItem>
                      <SelectItem value="INATIVO">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </section>
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Turmas</h3>
              <p className="text-xs text-slate-500">Selecione as turmas incluídas neste combo.</p>
            </header>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {turmasLoading && <p className="text-xs text-slate-500">Carregando turmas...</p>}
              {!turmasLoading && turmas.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma turma disponível.</p>
              )}
              {!turmasLoading &&
                turmas.map((t) => {
                  const checked = values.turmaIds.includes(t.id);
                  const modalidadeNome = (t as { modalidadeNome?: string }).modalidadeNome;
                  return (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-accent focus:ring-brand-accent"
                        checked={checked}
                        onChange={() => toggleTurma(t.id)}
                      />
                      <span className="flex-1">
                        <span className="block font-medium text-slate-700">{t.nome}</span>
                        {modalidadeNome ? (
                          <span className="block text-[10px] text-slate-500">{modalidadeNome}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
            </div>
          </section>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="min-w-[120px] border-slate-200 text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="min-w-[136px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
          >
            {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar combo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ComboDialog;
