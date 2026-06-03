'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EVENT_COSTUME_CATEGORIES, EVENT_COSTUME_CATEGORY_LABELS } from '@alusa/shared';

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

import { createCostume, updateCostume, type CostumeDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, nullableString, numberValue } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';

export function CostumeFormDialog({
  eventId,
  trigger,
  costume,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  trigger?: React.ReactNode;
  costume?: CostumeDTO;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;
  const [schoolCostText, setSchoolCostText] = useState("");
  const [chargedValueText, setChargedValueText] = useState("");

  useEffect(() => {
    if (open) {
      const cost = costume?.schoolCost ?? 0;
      setSchoolCostText(cost > 0 ? cost.toFixed(2).replace('.', ',') : "");
      const charge = costume?.chargedValue ?? 0;
      setChargedValueText(charge > 0 ? charge.toFixed(2).replace('.', ',') : "");
    } else {
      setSchoolCostText("");
      setChargedValueText("");
    }
  }, [open, costume]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      costume ? updateCostume(costume.id, payload) : createCostume(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.costumes(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: costume ? 'Figurino atualizado' : 'Figurino cadastrado',
        description: costume ? 'O figurino foi atualizado com sucesso.' : 'O figurino foi cadastrado com sucesso.'
      });
      setOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro no figurino', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const schoolCostRaw = nullableString(formData, 'schoolCost') ?? '';
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';

    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      category: nullableString(formData, 'category'),
      size: nullableString(formData, 'size'),
      color: nullableString(formData, 'color'),
      accessories: nullableString(formData, 'accessories'),
      schoolCost: schoolCostRaw ? parseCurrencyInput(schoolCostRaw) : null,
      chargedValue: chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : null,
      supplier: nullableString(formData, 'supplier'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      description: nullableString(formData, 'description'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{costume ? 'Editar figurino' : 'Novo figurino'}</DialogTitle>
          <DialogDescription>Cadastre peças, custos e valores cobrados.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome"><Input name="name" required defaultValue={costume?.name} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Categoria"><NativeSelect name="category" defaultValue={costume?.category ?? "CLOTHING"} options={EVENT_COSTUME_CATEGORIES.map((category) => ({ value: category, label: EVENT_COSTUME_CATEGORY_LABELS[category] }))} /></Field>
            <Field label="Tamanho"><Input name="size" defaultValue={costume?.size ?? ''} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Cor"><Input name="color" defaultValue={costume?.color ?? ''} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Custo escola">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="schoolCost"
                  type="text"
                  value={schoolCostText}
                  onChange={(e) => setSchoolCostText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
            <Field label="Valor cobrado (opcional)">
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
            <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={costume?.quantity ?? 1} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Fornecedor"><Input name="supplier" defaultValue={costume?.supplier ?? ''} className={FILTER_INPUT_CLASS} /></Field>
          </div>
          <Field label="Acessórios inclusos"><Input name="accessories" defaultValue={costume?.accessories ?? ''} className={FILTER_INPUT_CLASS} /></Field>
          <Field label="Descrição"><Textarea name="description" defaultValue={costume?.description ?? ''} className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Salvar figurino</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
