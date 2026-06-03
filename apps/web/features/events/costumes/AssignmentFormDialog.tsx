'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS, type EventCostumeAssignmentBillingMode } from '@alusa/shared';

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

import { createCostumeAssignment, type CostumeDTO, type EventResources } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { COSTUME_BILLING_OPTIONS } from './costume-billing-ui';

export function AssignmentFormDialog({ eventId, costumes, resources, trigger }: { eventId: string; costumes: CostumeDTO[]; resources?: EventResources; trigger: React.ReactNode }) {

  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chargedValueText, setChargedValueText] = useState("");
  const [billingMode, setBillingMode] = useState<EventCostumeAssignmentBillingMode>('INCLUDED_IN_REGISTRATION_FEE');
  const isSeparateCharge = billingMode === 'SEPARATE_CHARGE';

  const mutation = useMutation({
    mutationFn: createCostumeAssignment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Entrega cadastrada', description: 'A entrega do figurino foi registrada com sucesso.' });
      setOpen(false);
      setChargedValueText("");
      setBillingMode('INCLUDED_IN_REGISTRATION_FEE');
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
      setOpen(val);
      if (!val) {
        setChargedValueText("");
        setBillingMode('INCLUDED_IN_REGISTRATION_FEE');
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Vincular figurino</DialogTitle><DialogDescription>Defina o vínculo, entrega e forma de cobrança.</DialogDescription></DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Figurino"><NativeSelect name="costumeId" required placeholder="Selecione" options={costumes.map((item) => ({ value: item.id, label: item.name }))} /></Field>
            <Field label="Aluno"><NativeSelect name="alunoId" placeholder="Opcional" options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Turma"><NativeSelect name="turmaId" placeholder="Opcional" options={(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Tamanho definido"><Input name="definedSize" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue="PENDING" options={Object.entries(EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
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
          <DialogFooter><Button type="submit">Salvar vínculo</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
