'use client';

import { EventMutationOverlay } from '@/features/events/components/EventMutationOverlay';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type EventCostumeAssignmentBillingMode } from '@alusa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { createCostumeAssignment, type CostumeDTO, type EventScopedResources } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, handleFormDataSubmit, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { mergeScopedPersonOptions } from '../shared/event-scoped-resource-options';
import { COSTUME_BILLING_OPTIONS } from './costume-billing-ui';

export function AssignmentFormDialog({ eventId, costumes, scopedResources, trigger }: { eventId: string; costumes: CostumeDTO[]; scopedResources?: EventScopedResources; trigger: React.ReactNode }) {

  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chargedValueText, setChargedValueText] = useState("");
  const [billingMode, setBillingMode] = useState<EventCostumeAssignmentBillingMode>('INCLUDED_IN_REGISTRATION_FEE');
  const [alunoId, setAlunoId] = useState('');
  const [turmaId, setTurmaId] = useState('');
  const isSeparateCharge = billingMode === 'SEPARATE_CHARGE';

  const mutation = useMutation({
    mutationFn: createCostumeAssignment,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] }),
      ]);
      const createdSummary = result.createdCount === 0
        ? 'Nenhum figurino novo foi associado.'
        : result.createdCount === 1
          ? '1 figurino foi associado.'
          : `${result.createdCount} figurinos foram associados.`;
      const existingSummary = result.skippedExistingCount === 0
        ? ''
        : result.skippedExistingCount === 1
          ? ' 1 associação que já existia foi mantida.'
          : ` ${result.skippedExistingCount} associações que já existiam foram mantidas.`;
      toast.success({ title: 'Figurinos atualizados', description: `${createdSummary}${existingSummary}` });
      setOpen(false);
      setChargedValueText("");
      setBillingMode('INCLUDED_IN_REGISTRATION_FEE');
      setAlunoId('');
      setTurmaId('');
    },
    onError: (error) => toast.error({ title: 'Erro na entrega', description: (error as Error).message }),
  });
  function submit(formData: FormData) {
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';
    const selectedBillingMode = (nullableString(formData, 'billingMode') ?? 'INCLUDED_IN_REGISTRATION_FEE') as EventCostumeAssignmentBillingMode;

    mutation.mutate({
      eventId,
      costumeId: nullableString(formData, 'costumeId'),
      alunoId: nullableString(formData, 'alunoId'),
      turmaId: nullableString(formData, 'turmaId'),
      definedSize: nullableString(formData, 'definedSize'),
      status: nullableString(formData, 'status'),
      billingMode: selectedBillingMode,
      chargedValue: selectedBillingMode === 'SEPARATE_CHARGE' && chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : undefined,
      notes: nullableString(formData, 'notes'),
    });
  }
  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val && mutation.isPending) return;
      setOpen(val);
      if (!val) {
        setChargedValueText("");
        setBillingMode('INCLUDED_IN_REGISTRATION_FEE');
        setAlunoId('');
        setTurmaId('');
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl relative" aria-busy={mutation.isPending}>
        <DialogHeader><DialogTitle>Vincular figurino</DialogTitle><DialogDescription>Vínculos a uma turma serão expandidos para uma peça e uma cobrança individual por aluno ativo inscrito no evento.</DialogDescription></DialogHeader>
        <form inert={mutation.isPending || undefined} onSubmit={(event) => handleFormDataSubmit(event, submit)} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Figurino"><NativeSelect name="costumeId" required placeholder="Selecione" options={costumes.map((item) => ({ value: item.id, label: item.name }))} /></Field>
            <Field label="Aluno"><NativeSelect name="alunoId" value={alunoId} onValueChange={(value) => { setAlunoId(value); if (value) setTurmaId(''); }} placeholder="Selecione um aluno" options={mergeScopedPersonOptions(scopedResources?.alunos ?? [])} /></Field>
            <Field label="Turma"><NativeSelect name="turmaId" value={turmaId} onValueChange={(value) => { setTurmaId(value); if (value) setAlunoId(''); }} placeholder="Selecione uma turma" options={mergeScopedPersonOptions(scopedResources?.turmas ?? [])} /></Field>
            <Field label="Tamanho definido"><Input name="definedSize" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Forma de cobrança">
              <NativeSelect
                name="billingMode"
                defaultValue="INCLUDED_IN_REGISTRATION_FEE"
                options={COSTUME_BILLING_OPTIONS}
                onValueChange={(value) => setBillingMode(value as EventCostumeAssignmentBillingMode)}
              />
            </Field>
            {isSeparateCharge ? (
            <Field label="Valor cobrado">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="chargedValue"
                  type="text"
                  value={chargedValueText}
                  onChange={(e) => setChargedValueText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
            ) : null}
          </div>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando' : 'Salvar vínculo'}</Button></DialogFooter>
        </form>

        <EventMutationOverlay pending={mutation.isPending} label="Salvando vínculo" />
      </DialogContent>
    </Dialog>
  );
}
