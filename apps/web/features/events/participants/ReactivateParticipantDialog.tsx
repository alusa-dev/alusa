'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { reactivateEventParticipant, type EventParticipantDTO, type SchoolEventDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { parseCurrencyInput } from '../shared/event-formatters';
import { ParticipantBillingFields, type ParticipantBillingMethod, type ParticipantChargeType } from './ParticipantBillingFields';

export function ReactivateParticipantDialog({
  eventId,
  event,
  participant,
  open,
  onOpenChange,
}: {
  eventId: string;
  event: SchoolEventDTO;
  participant: EventParticipantDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [billingMethod, setBillingMethod] = useState<ParticipantBillingMethod>('');
  const [chargeType, setChargeType] = useState<ParticipantChargeType>('ONE_TIME');
  const [feeText, setFeeText] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (open) {
      const defaultFee = participant?.registrationFeeCharged ?? event.registrationFee ?? 0;
      setFeeText(defaultFee > 0 ? defaultFee.toFixed(2).replace('.', ',') : '0,00');
      return;
    }

    setBillingMethod('');
    setChargeType('ONE_TIME');
    setFeeText('');
    setDueDate(undefined);
  }, [event.registrationFee, open, participant?.registrationFeeCharged]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!participant) throw new Error('Participante não encontrado.');
      return reactivateEventParticipant(eventId, participant.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
      toast.success({ title: 'Aluno reinscrito', description: 'A inscrição foi reativada e uma nova cobrança foi gerada quando aplicável.' });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao reinscrever aluno', description: error.message });
    },
  });

  function handleReactivate(formData: FormData) {
    const registrationFeeCharged = parseCurrencyInput(String(formData.get('registrationFeeCharged') || '0'));
    const selectedBilling = String(formData.get('billingMethod') || 'MANUAL_RECEIVED');
    const isFeePaid = selectedBilling === 'MANUAL_RECEIVED';
    const feePaymentMethod = isFeePaid ? String(formData.get('feePaymentMethod') || 'OTHER') : selectedBilling;
    const notes = String(formData.get('notes') || '');
    const resolvedChargeType = selectedBilling === 'PIX' ? 'ONE_TIME' : String(formData.get('chargeType') || 'ONE_TIME');
    const dueDateValue = formData.get('dueDate') ? String(formData.get('dueDate')) : undefined;

    if (selectedBilling !== 'MANUAL_RECEIVED' && !dueDateValue) {
      toast.error({ title: 'Aviso', description: 'Por favor, selecione a data de vencimento da primeira cobrança.' });
      return;
    }

    mutation.mutate({
      registrationFeeCharged,
      billingMethod: selectedBilling,
      feePaymentMethod: registrationFeeCharged > 0 ? feePaymentMethod : undefined,
      notes,
      chargeType: resolvedChargeType,
      dueDate: dueDateValue,
      installmentCount: resolvedChargeType === 'INSTALLMENT' ? Number(formData.get('installmentCount') || 2) : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reinscrever aluno</DialogTitle>
          <DialogDescription>
            Gere uma nova cobrança para reativar a inscrição cancelada de {participant?.displayName ?? 'participante'}.
          </DialogDescription>
        </DialogHeader>
        <form key={open ? participant?.id ?? 'open' : 'closed'} action={handleReactivate} className="space-y-4 mt-2">
          <ParticipantBillingFields
            billingMethod={billingMethod}
            chargeType={chargeType}
            feeText={feeText}
            dueDate={dueDate}
            onBillingMethodChange={setBillingMethod}
            onChargeTypeChange={setChargeType}
            onFeeTextChange={setFeeText}
            onDueDateChange={setDueDate}
          />
          <Field label="Observações">
            <Textarea name="notes" className="min-h-16 rounded-lg border-slate-200" defaultValue={participant?.notes ?? ''} />
          </Field>
          <DialogFooter className="pt-2">
            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? 'Reinscrevendo...' : 'Reinscrever aluno'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
