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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import {
  EventApiError,
  registerEventParticipant,
  type SchoolEventDTO,
} from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { parseCurrencyInput } from '../shared/event-formatters';
import { ParticipantBillingFields, type ParticipantBillingMethod, type ParticipantChargeType, type ParticipantNotificationChannel } from './ParticipantBillingFields';
import { useStudentAutocomplete } from './useStudentAutocomplete';

type CancelledParticipantConflict = {
  participantId: string;
  reasons: string[];
};

function parseCancelledParticipantConflict(details: unknown): CancelledParticipantConflict | null {
  if (!details || typeof details !== 'object') return null;
  const record = details as Record<string, unknown>;
  if (typeof record.participantId !== 'string') return null;
  return {
    participantId: record.participantId,
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [],
  };
}

export function RegisterParticipantDialog({ eventId, event, open, onOpenChange }: { eventId: string; event: SchoolEventDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [billingMethod, setBillingMethod] = useState<ParticipantBillingMethod>('');
  const [chargeType, setChargeType] = useState<ParticipantChargeType>('ONE_TIME');
  const [feeText, setFeeText] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [notificationChannels, setNotificationChannels] = useState<ParticipantNotificationChannel[]>([]);
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
      setNotificationChannels([]);
      setCancelledParticipant(null);
    }
  }, [open, event.registrationFee, resetAutocomplete]);

  const invalidateParticipants = () => {
    queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.scopedResources(eventId) });
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

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (registerMutation.isPending) return;
    setCloseConfirmOpen(true);
  }

  function confirmCloseDialog() {
    setCloseConfirmOpen(false);
    onOpenChange(false);
  }

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
      notificationChannels,
      notificationChannelsConfigured: true,
    };

    registerMutation.mutate(payload);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className={PRIMARY_BUTTON_CLASS} onClick={() => onOpenChange(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Inscrever aluno
        </Button>
      </DialogTrigger>
      <DialogContent className="flex w-[calc(100vw-2rem)] max-w-md min-h-0 max-h-[min(90dvh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden bg-slate-50 p-0 sm:rounded-2xl">
        <form key={open ? 'open' : 'closed'} action={handleRegisterParticipant} className="flex min-h-0 max-h-[min(90dvh,calc(100dvh-2rem))] flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-5 pr-14 text-left sm:px-6 sm:py-6">
            <DialogTitle className="text-xl font-semibold text-slate-900">Inscrever aluno no evento</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-5 text-slate-600">Selecione um aluno cadastrado e especifique a taxa cobrada.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 [scrollbar-gutter:stable] sm:px-6 sm:py-6">
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
              <p className="mt-1">Exclua a inscrição cancelada antes de realizar uma nova inscrição.</p>
              {cancelledParticipant.reasons.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                  {cancelledParticipant.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
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
            notificationChannels={notificationChannels}
            onNotificationChannelsChange={setNotificationChannels}
          />
          <Field label="Observações">
            <Textarea name="notes" className="min-h-16 rounded-lg border-slate-200" />
          </Field>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
            <Button type="submit" disabled={registerMutation.isPending} className="w-full">
              {registerMutation.isPending ? 'Inscrevendo...' : 'Confirmar inscrição'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={closeConfirmOpen}
      onOpenChange={setCloseConfirmOpen}
      title="Sair da inscrição?"
      description="Os dados preenchidos serão descartados. Deseja realmente fechar este formulário?"
      confirmText="Sair sem salvar"
      cancelText="Continuar preenchendo"
      variant="destructive"
      onConfirm={confirmCloseDialog}
    />
    </>
  );
}
