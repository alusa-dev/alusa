'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { AutocompleteList } from '@/components/matriculas/wizard/shared/AutocompleteList';
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

import {
  EventApiError,
  reactivateEventParticipant,
  registerEventParticipant,
  removeEventParticipant,
  type SchoolEventDTO,
} from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { parseCurrencyInput } from '../shared/event-formatters';
import { ParticipantBillingFields, type ParticipantBillingMethod, type ParticipantChargeType } from './ParticipantBillingFields';
import { useStudentAutocomplete } from './useStudentAutocomplete';

type CancelledParticipantConflict = {
  participantId: string;
  canRemove: boolean;
  canReactivate: boolean;
  reasons: string[];
};

function parseCancelledParticipantConflict(details: unknown): CancelledParticipantConflict | null {
  if (!details || typeof details !== 'object') return null;
  const record = details as Record<string, unknown>;
  if (typeof record.participantId !== 'string') return null;
  return {
    participantId: record.participantId,
    canRemove: record.canRemove === true,
    canReactivate: record.canReactivate === true,
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [],
  };
}

export function RegisterParticipantDialog({ eventId, event, open, onOpenChange }: { eventId: string; event: SchoolEventDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [billingMethod, setBillingMethod] = useState<ParticipantBillingMethod>('');
  const [chargeType, setChargeType] = useState<ParticipantChargeType>('ONE_TIME');
  const [feeText, setFeeText] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [cancelledParticipant, setCancelledParticipant] = useState<CancelledParticipantConflict | null>(null);
  const autocomplete = useStudentAutocomplete({ enabled: open });
  const {
    resetAutocomplete,
    selectedStudent,
    studentQuery,
    studentResults,
    searchLoading,
    showSuggestions,
    highlightedIndex,
    setHighlightedIndex,
    setShowSuggestions,
    changeStudentQuery,
    selectStudent,
  } = autocomplete;

  useEffect(() => {
    if (open) {
      const defaultFee = event.registrationFee ?? 0;
      setFeeText(defaultFee > 0 ? defaultFee.toFixed(2).replace('.', ',') : '0,00');
    } else {
      resetAutocomplete();
      setBillingMethod('');
      setChargeType('ONE_TIME');
      setFeeText('');
      setDueDate(undefined);
      setLastPayload(null);
      setCancelledParticipant(null);
    }
  }, [open, event.registrationFee, resetAutocomplete]);

  const invalidateParticipants = () => {
    queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
  };

  const registerMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => registerEventParticipant(eventId, payload),
    onSuccess: () => {
      invalidateParticipants();
      onOpenChange(false);
      toast.success({ title: 'Aluno inscrito', description: 'A inscrição do participante foi realizada com sucesso.' });
    },
    onError: (error) => {
      if (error instanceof EventApiError && error.code === 'PARTICIPANTE_CANCELADO_EXISTENTE') {
        const conflict = parseCancelledParticipantConflict(error.details);
        if (conflict) {
          setCancelledParticipant(conflict);
        }
      }
      toast.error({ title: 'Erro ao inscrever aluno', description: error.message });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => {
      if (!cancelledParticipant || !lastPayload) {
        throw new Error('Não foi possível localizar a inscrição cancelada para reinscrever.');
      }
      return reactivateEventParticipant(eventId, cancelledParticipant.participantId, lastPayload);
    },
    onSuccess: () => {
      invalidateParticipants();
      onOpenChange(false);
      toast.success({ title: 'Aluno reinscrito', description: 'A inscrição foi reativada e uma nova cobrança foi gerada quando aplicável.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao reinscrever aluno', description: error.message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (participantId: string) => removeEventParticipant(eventId, participantId),
    onSuccess: () => {
      invalidateParticipants();
      setCancelledParticipant(null);
      setLastPayload(null);
      resetAutocomplete();
      toast.success({ title: 'Aluno removido do evento', description: 'A inscrição cancelada sem histórico foi removida.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao remover aluno do evento', description: error.message });
    },
  });

  function handleRegisterParticipant(formData: FormData) {
    setCancelledParticipant(null);
    const alunoId = selectedStudent?.id || '';
    if (!alunoId) {
      toast.error({ title: 'Aviso', description: 'Por favor, selecione um aluno válido.' });
      return;
    }
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
    const installmentCount = resolvedChargeType === 'INSTALLMENT' ? Number(formData.get('installmentCount') || 2) : undefined;

    const payload = {
      alunoId,
      registrationFeeCharged,
      billingMethod: selectedBilling,
      feePaymentMethod: registrationFeeCharged > 0 ? feePaymentMethod : undefined,
      notes,
      chargeType: resolvedChargeType,
      dueDate: dueDateValue,
      installmentCount,
    };

    setLastPayload(payload);
    registerMutation.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className={PRIMARY_BUTTON_CLASS} onClick={() => onOpenChange(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Inscrever aluno
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inscrever Aluno no Evento</DialogTitle>
          <DialogDescription>Selecione um aluno cadastrado e especifique a taxa cobrada.</DialogDescription>
        </DialogHeader>
        <form key={open ? 'open' : 'closed'} action={handleRegisterParticipant} className="space-y-4 mt-2">
          <Field label="Aluno">
            <div className="relative">
              <Input
                type="text"
                value={studentQuery}
                onChange={(event) => changeStudentQuery(event.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                onKeyDown={(event) => {
                  if (!studentResults.length) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setHighlightedIndex((curr) => Math.min(curr + 1, studentResults.length - 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setHighlightedIndex((curr) => Math.max(curr - 1, 0));
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    const option = studentResults[highlightedIndex];
                    if (option) selectStudent(option);
                  } else if (event.key === 'Escape') {
                    setShowSuggestions(false);
                  }
                }}
                className={FILTER_INPUT_CLASS}
                placeholder="Busque pelo nome do aluno..."
                required
              />

              {showSuggestions && (studentQuery.trim().length >= 2 || searchLoading) && (
                <AutocompleteList
                  id="event-student-suggestions"
                  options={studentResults}
                  highlightedIndex={highlightedIndex}
                  selectedValue={selectedStudent?.id || undefined}
                  onSelect={selectStudent}
                  renderDescription={(option) => option.description}
                  className="max-h-48 shadow-lg rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
            {selectedStudent && (
              <p className="text-xs text-slate-500 mt-1">
                Selecionado: <span className="font-semibold text-slate-900">{selectedStudent.nome}</span>
              </p>
            )}
          </Field>
          {cancelledParticipant && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Este aluno já teve uma inscrição cancelada neste evento.</p>
              <p className="mt-1">Você pode reinscrever o aluno e gerar uma nova cobrança.</p>
              {cancelledParticipant.reasons.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                  {cancelledParticipant.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  size="sm"
                  disabled={!cancelledParticipant.canReactivate || reactivateMutation.isPending}
                  onClick={() => reactivateMutation.mutate()}
                >
                  {reactivateMutation.isPending ? 'Reinscrevendo...' : 'Reinscrever aluno'}
                </Button>
                {cancelledParticipant.canRemove && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(cancelledParticipant.participantId)}
                  >
                    {removeMutation.isPending ? 'Removendo...' : 'Remover aluno do evento'}
                  </Button>
                )}
              </div>
            </div>
          )}
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
            <Textarea name="notes" className="min-h-16 rounded-lg border-slate-200" />
          </Field>
          <DialogFooter className="pt-2">
            <Button type="submit" disabled={registerMutation.isPending} className="w-full">
              {registerMutation.isPending ? 'Inscrevendo...' : 'Confirmar inscrição'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
