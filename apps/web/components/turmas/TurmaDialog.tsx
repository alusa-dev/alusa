import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type {
  TurmaListItem,
  TurmaStatus,
} from '@/features/cadastro/turmas/services/turmas-service';
import { useTurmaLookups } from '@/hooks/use-turma-lookups';
import { useProfessoresLookup } from '@/hooks/use-professores-lookup';
// Removido dialog interno de criação rápida; usaremos eventos globais para abrir diálogos existentes

export type TurmaDialogMode = 'create' | 'edit';

export interface TurmaDialogProps {
  open: boolean;
  mode: TurmaDialogMode;
  turma: TurmaListItem | null;
  contaId: string;
  onOpenChange: (_open: boolean) => void;
  onSaved?: (_turma: TurmaListItem) => void;
  onError?: (_message: string) => void;
}

interface FormState {
  nome: string;
  status: TurmaStatus;
  capacidade: string; // manter string para facilitar digitação
  horaInicio: string; // HH:MM
  horaFim: string; // HH:MM
  modalidadeId: string;
  salaId: string;
  diasSemana: string[]; // SEG...DOM
  idadeMin: string; // string para controle fácil
  idadeMax: string;
  observacao: string;
  professoresIds: string[];
}

type FieldKey = keyof FormState;
interface ErrorState {
  nome?: string;
  status?: string;
  capacidade?: string;
  horaInicio?: string;
  horaFim?: string;
  modalidadeId?: string;
  salaId?: string;
  diasSemana?: string;
  idadeMin?: string;
  idadeMax?: string;
  observacao?: string;
  professoresIds?: string;
}

const inputClass =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 focus:border-[#A94DFF] md:h-10';
const selectTriggerClass = cn(inputClass, 'flex items-center justify-between gap-2 text-left');
const sectionClass = 'space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5';
const labelClass = 'text-xs font-medium text-slate-600';
const helperClass = 'text-xs text-slate-500';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

const defaultState: FormState = {
  nome: '',
  status: 'ATIVO',
  capacidade: '',
  horaInicio: '',
  horaFim: '',
  modalidadeId: '',
  salaId: '',
  diasSemana: [],
  idadeMin: '',
  idadeMax: '',
  observacao: '',
  professoresIds: [],
};

function normalizeTime(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5);
  return value;
}

function minutesFrom(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export default function TurmaDialog({
  open,
  mode,
  turma,
  contaId,
  onOpenChange,
  onSaved,
  onError,
}: TurmaDialogProps) {
  const [values, setValues] = useState<FormState>(defaultState);
  const [errors, setErrors] = useState<ErrorState>({});
  const [submitting, setSubmitting] = useState(false);
  const lookups = useTurmaLookups(contaId);
  const professoresLookup = useProfessoresLookup(contaId);
  const loadingLookups = lookups.loading || professoresLookup.loading;
  // Criação de modalidade/sala agora delega para módulos dedicados via eventos

  function openGlobalModalidadeDialog() {
    window.dispatchEvent(new CustomEvent('modalidade:dialog:new'));
  }

  function openGlobalSalaDialog() {
    window.dispatchEvent(new CustomEvent('sala:dialog:new'));
  }

  const statusOptions = useMemo(
    () => [
      { value: 'ATIVO' as TurmaStatus, label: 'Ativa' },
      { value: 'INATIVO' as TurmaStatus, label: 'Inativa' },
    ],
    [],
  );

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && turma) {
        setValues({
          nome: turma.nome || '',
          status: turma.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
          capacidade: turma.capacidade != null ? String(turma.capacidade) : '',
          horaInicio: normalizeTime(turma.horaInicio),
          horaFim: normalizeTime(turma.horaFim),
          modalidadeId: turma.modalidadeId || '',
          salaId: turma.salaId || '',
          diasSemana: Array.isArray(turma.diasSemana) ? turma.diasSemana : [],
          idadeMin: '',
          idadeMax: '',
          observacao: turma.descricao || '',
          professoresIds: Array.isArray(turma.professores)
            ? turma.professores.map((p) => p.id)
            : [],
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
  }, [open, mode, turma]);

  function handleChange<K extends FieldKey>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const next: ErrorState = {};
    if (!values.nome.trim()) next.nome = 'Informe o nome da turma.';
    const capacidadeNum = Number(values.capacidade);
    if (!values.capacidade.trim() || Number.isNaN(capacidadeNum) || capacidadeNum <= 0) {
      next.capacidade = 'Informe uma capacidade válida (> 0).';
    }
    if (!values.horaInicio.trim()) next.horaInicio = 'Informe a hora de início.';
    if (!values.horaFim.trim()) next.horaFim = 'Informe a hora de término.';
    const start = minutesFrom(values.horaInicio.trim());
    const end = minutesFrom(values.horaFim.trim());
    if (start != null && end != null && end <= start) {
      next.horaFim = 'Hora final deve ser depois da inicial.';
    }
    if (!values.modalidadeId) next.modalidadeId = 'Selecione a modalidade.';
    if (!values.salaId) next.salaId = 'Selecione a sala.';
    if (!values.diasSemana.length) next.diasSemana = 'Selecione ao menos um dia.';
    const idadeMinNum = values.idadeMin ? Number(values.idadeMin) : null;
    const idadeMaxNum = values.idadeMax ? Number(values.idadeMax) : null;
    if (values.idadeMin && (Number.isNaN(idadeMinNum) || (idadeMinNum as number) < 0)) {
      next.idadeMin = 'Idade mínima inválida';
    }
    if (values.idadeMax && (Number.isNaN(idadeMaxNum) || (idadeMaxNum as number) < 0)) {
      next.idadeMax = 'Idade máxima inválida';
    }
    if (
      idadeMinNum != null &&
      idadeMaxNum != null &&
      !Number.isNaN(idadeMinNum) &&
      !Number.isNaN(idadeMaxNum) &&
      (idadeMinNum as number) > (idadeMaxNum as number)
    ) {
      next.idadeMax = 'Mínima não pode ser maior que máxima';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      // Monta payload baseado no modelo anterior de updateTurma/createTurma
      const payloadBase = {
        contaId,
        nome: values.nome.trim(),
        status: values.status,
        capacidade: Number(values.capacidade),
        horaInicio: values.horaInicio.trim(),
        horaFim: values.horaFim.trim(),
        modalidadeId: values.modalidadeId,
        salaId: values.salaId,
        diasSemana: values.diasSemana,
        // Campos idadeMin/idadeMax ainda não existem no backend -> ignorar no payload
        descricao: values.observacao.trim() || undefined,
        professoresIds: values.professoresIds,
      };

      let saved: TurmaListItem;
      if (mode === 'edit' && turma) {
        const patchPayload: Omit<typeof payloadBase, 'descricao'> & { observacao?: string } = {
          ...payloadBase,
          ...(payloadBase.descricao ? { observacao: payloadBase.descricao } : {}),
        };
        // Removemos descricao explicitamente não incluindo na construção acima.
        const res = await fetch(`/api/turmas/${turma.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchPayload),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(json?.error?.message || json?.detail || 'Erro ao atualizar turma.');
        saved = json?.data as TurmaListItem;
      } else {
        const createPayload = {
          ...payloadBase,
          ...(payloadBase.descricao ? { observacao: payloadBase.descricao } : {}),
        };
        const res = await fetch('/api/turmas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(json?.error?.message || json?.detail || 'Erro ao criar turma.');
        saved = json?.data as TurmaListItem;
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
        <DialogContent
          fullScreenMobile
          className="flex w-full max-w-3xl min-h-0 flex-col gap-0 overflow-hidden bg-slate-50 p-0 max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[90vh]"
        >
          <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-5 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
              {mode === 'edit' ? 'Editar turma' : 'Nova turma'}
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-sm text-slate-600">
              {mode === 'edit' ? 'Atualize os dados da turma.' : 'Cadastre uma nova turma.'}
            </DialogDescription>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto scroll-smooth px-4 py-6 max-md:min-h-0 md:px-6">
            <section className={sectionClass}>
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-slate-800">Informações gerais</h3>
                <p className={helperClass}>Nome, status, capacidade, modalidade e sala.</p>
              </header>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="turma-nome">
                    Nome da turma
                  </label>
                  <Input
                    id="turma-nome"
                    value={values.nome}
                    onChange={(e) => handleChange('nome', e.target.value)}
                    placeholder="Ex.: Ballet 1 - Matutino"
                    className={cn(
                      inputClass,
                      errors.nome &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.nome ? <p className={errorClass}>{errors.nome}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Status</label>
                  <Select
                    value={values.status}
                    onValueChange={(val) => handleChange('status', val as TurmaStatus)}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Modalidade</label>
                  <Select
                    value={values.modalidadeId}
                    onValueChange={(val) => {
                      if (val === '__create__') {
                        openGlobalModalidadeDialog();
                        return;
                      }
                      handleChange('modalidadeId', val);
                    }}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder={loadingLookups ? 'Carregando...' : 'Selecione'} />
                    </SelectTrigger>
                    <SelectContent>
                      {lookups.modalidades.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                        </SelectItem>
                      ))}
                      <div className="my-1 h-px bg-slate-200" />
                      <SelectItem value="__create__" className="!text-violet-600 !font-medium">
                        + Criar nova modalidade
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.modalidadeId ? <p className={errorClass}>{errors.modalidadeId}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Sala</label>
                  <Select
                    value={values.salaId}
                    onValueChange={(val) => {
                      if (val === '__create__') {
                        openGlobalSalaDialog();
                        return;
                      }
                      handleChange('salaId', val);
                    }}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder={loadingLookups ? 'Carregando...' : 'Selecione'} />
                    </SelectTrigger>
                    <SelectContent>
                      {lookups.salas.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.nome}
                        </SelectItem>
                      ))}
                      <div className="my-1 h-px bg-slate-200" />
                      <SelectItem value="__create__" className="!text-violet-600 !font-medium">
                        + Criar nova sala
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.salaId ? <p className={errorClass}>{errors.salaId}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Capacidade (alunos)</label>
                  <Input
                    inputMode="numeric"
                    value={values.capacidade}
                    onChange={(e) => handleChange('capacidade', e.target.value)}
                    placeholder="Ex.: 20"
                    className={cn(
                      inputClass,
                      errors.capacidade &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.capacidade ? <p className={errorClass}>{errors.capacidade}</p> : null}
                </div>
              </div>
            </section>
            <section className={sectionClass}>
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-slate-800">Agenda & Horário</h3>
                <p className={helperClass}>Dias da semana e horários.</p>
              </header>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((d) => {
                    const ativo = values.diasSemana.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          handleChange(
                            'diasSemana',
                            ativo
                              ? values.diasSemana.filter((x) => x !== d)
                              : [...values.diasSemana, d],
                          )
                        }
                        className={`px-2 py-1 rounded border text-xs font-medium transition ${ativo ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                {errors.diasSemana ? <p className={errorClass}>{errors.diasSemana}</p> : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className={labelClass}>Hora de início</label>
                    <Input
                      type="time"
                      value={values.horaInicio}
                      onChange={(e) => handleChange('horaInicio', e.target.value)}
                      className={cn(
                        inputClass,
                        errors.horaInicio &&
                        'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                      )}
                    />
                    {errors.horaInicio ? <p className={errorClass}>{errors.horaInicio}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={labelClass}>Hora de término</label>
                    <Input
                      type="time"
                      value={values.horaFim}
                      onChange={(e) => handleChange('horaFim', e.target.value)}
                      className={cn(
                        inputClass,
                        errors.horaFim &&
                        'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                      )}
                    />
                    {errors.horaFim ? <p className={errorClass}>{errors.horaFim}</p> : null}
                  </div>
                </div>
              </div>
            </section>
            <section className={sectionClass}>
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-slate-800">Restrições & Observações</h3>
                <p className={helperClass}>Faixa etária (opcional) e observações.</p>
              </header>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Idade mínima</label>
                  <Input
                    inputMode="numeric"
                    value={values.idadeMin}
                    onChange={(e) => handleChange('idadeMin', e.target.value)}
                    placeholder="Ex.: 7"
                    className={cn(
                      inputClass,
                      errors.idadeMin &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.idadeMin ? <p className={errorClass}>{errors.idadeMin}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Idade máxima</label>
                  <Input
                    inputMode="numeric"
                    value={values.idadeMax}
                    onChange={(e) => handleChange('idadeMax', e.target.value)}
                    placeholder="Ex.: 12"
                    className={cn(
                      inputClass,
                      errors.idadeMax &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.idadeMax ? <p className={errorClass}>{errors.idadeMax}</p> : null}
                </div>
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass}>Observação</label>
                  <Textarea
                    value={values.observacao}
                    onChange={(e) => handleChange('observacao', e.target.value)}
                    rows={3}
                    placeholder="Anotações internas, materiais necessários, etc."
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 focus:border-[#A94DFF] resize-none"
                  />
                </div>
              </div>
            </section>
            <section className={sectionClass}>
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-slate-800">Professores</h3>
                <p className={helperClass}>Seleção opcional de professores.</p>
              </header>
              <div className="flex flex-wrap gap-2">
                {professoresLookup.professores.map((p) => {
                  const ativo = values.professoresIds.includes(p.id);
                  const disponivel = (p.status || 'ATIVO') === 'ATIVO';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!disponivel}
                      onClick={() =>
                        handleChange(
                          'professoresIds',
                          ativo
                            ? values.professoresIds.filter((x) => x !== p.id)
                            : [...values.professoresIds, p.id],
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-violet-400/60 focus:ring-offset-1 ${ativo ? 'bg-violet-600 text-white border-violet-700 shadow-sm' : 'bg-violet-100 text-violet-800 border-violet-300 hover:bg-violet-200 hover:border-violet-400'} ${!disponivel ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className="leading-tight">{p.nome}</span>
                      {!disponivel && (
                        <Badge status="INATIVO" className="ml-1 text-[9px]">
                          Inativo
                        </Badge>
                      )}
                    </button>
                  );
                })}
                {!professoresLookup.loading && professoresLookup.professores.length === 0 && (
                  <p className="text-xs text-slate-500">Nenhum professor cadastrado.</p>
                )}
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
              {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar turma'}
            </Button>
          </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Diálogo interno de criação rápida removido: criação é delegada via eventos globais */}
    </>
  );
}
