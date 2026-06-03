'use client';

import { useEffect, useState } from 'react';
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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { updateCostumeAssignment, type CostumeAssignmentDTO, type CostumeDTO, type EventResources } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { COSTUME_BILLING_OPTIONS } from './costume-billing-ui';

export function EditAssignmentFormDialog({
  eventId,
  assignment,
  costumes,
  resources,
  open,
  onOpenChange,
}: {
  eventId: string;
  assignment: CostumeAssignmentDTO;
  costumes: CostumeDTO[];
  resources?: EventResources;
  open: boolean;
  onOpenChange: (val: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [chargedValueText, setChargedValueText] = useState(
    assignment.chargedValue ? (assignment.chargedValue).toFixed(2).replace('.', ',') : ""
  );
  const [billingMode, setBillingMode] = useState<EventCostumeAssignmentBillingMode>(assignment.billingMode);
  const isSeparateCharge = billingMode === 'SEPARATE_CHARGE';

  useEffect(() => {
    if (open) {
      setChargedValueText(assignment.chargedValue ? (assignment.chargedValue).toFixed(2).replace('.', ',') : "");
      setBillingMode(assignment.billingMode);
    }
  }, [open, assignment.billingMode, assignment.chargedValue]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateCostumeAssignment(assignment.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Vínculo atualizado', description: 'O vínculo do figurino foi atualizado com sucesso.' });
      onOpenChange(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';
    const selectedBillingMode = (nullableString(formData, 'billingMode') ?? assignment.billingMode) as EventCostumeAssignmentBillingMode;

    mutation.mutate({
      costumeId: nullableString(formData, 'costumeId'),
      alunoId: nullableString(formData, 'alunoId') || null,
      turmaId: nullableString(formData, 'turmaId') || null,
      definedSize: nullableString(formData, 'definedSize'),
      status: nullableString(formData, 'status'),
      billingMode: selectedBillingMode,
      chargedValue: selectedBillingMode === 'SEPARATE_CHARGE' && chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : null,
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar vínculo</DialogTitle>
          <DialogDescription>Atualize o vínculo, entrega e forma de cobrança.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Figurino">
              <NativeSelect
                name="costumeId"
                required
                defaultValue={assignment.costume.id}
                placeholder="Selecione"
                options={costumes.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Field>
            <Field label="Aluno">
              <NativeSelect
                name="alunoId"
                defaultValue={assignment.aluno?.id || ""}
                placeholder="Opcional"
                options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Turma">
              <NativeSelect
                name="turmaId"
                defaultValue={assignment.turma?.id || ""}
                placeholder="Opcional"
                options={(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Tamanho definido">
              <Input name="definedSize" defaultValue={assignment.definedSize || ""} className={FILTER_INPUT_CLASS} />
            </Field>
            <Field label="Status">
              <NativeSelect
                name="status"
                defaultValue={assignment.status}
                options={Object.entries(EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Forma de cobrança">
              <NativeSelect
                name="billingMode"
                defaultValue={assignment.billingMode}
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
          <Field label="Observações">
            <Textarea name="notes" defaultValue={assignment.notes || ""} className="rounded-xl border-slate-200" />
          </Field>
          <DialogFooter>
            <Button type="submit">Salvar alterações</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
