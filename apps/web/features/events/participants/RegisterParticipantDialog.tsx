'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { EVENT_PAYMENT_METHOD_LABELS, EVENT_PAYMENT_METHODS } from '@alusa/shared';

import { AutocompleteList } from '@/components/matriculas/wizard/shared/AutocompleteList';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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

import { registerEventParticipant, type SchoolEventDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { useStudentAutocomplete } from './useStudentAutocomplete';

type ChargeType = 'ONE_TIME' | 'INSTALLMENT';

export function RegisterParticipantDialog({ eventId, event, open, onOpenChange }: { eventId: string; event: SchoolEventDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [billingMethod, setBillingMethod] = useState('');
  const [chargeType, setChargeType] = useState<ChargeType>('ONE_TIME');
  const [feeText, setFeeText] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
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
    }
  }, [open, event.registrationFee, resetAutocomplete]);

  const registerMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => registerEventParticipant(eventId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
      onOpenChange(false);
      toast.success({ title: 'Aluno inscrito', description: 'A inscrição do participante foi realizada com sucesso.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao inscrever aluno', description: error.message });
    },
  });

  function handleRegisterParticipant(formData: FormData) {
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

    registerMutation.mutate({
      alunoId,
      registrationFeeCharged,
      billingMethod: selectedBilling,
      feePaymentMethod: registrationFeeCharged > 0 ? feePaymentMethod : undefined,
      notes,
      chargeType: resolvedChargeType,
      dueDate: dueDateValue,
      installmentCount,
    });
  }

  const cleanFeeText = feeText.replace(/[^\d,]/g, '').replace(',', '.');
  const totalFeeVal = parseFloat(cleanFeeText) || 0;
  const installmentOptions: Array<{ value: string; label: string }> = [];
  if (totalFeeVal > 0) {
    for (let i = 2; i <= 12; i++) {
      const instVal = totalFeeVal / i;
      if (instVal >= 5.0) {
        installmentOptions.push({
          value: String(i),
          label: i + 'x de R$ ' + instVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      }
    }
  }
  if (installmentOptions.length === 0) {
    for (let i = 2; i <= 12; i++) {
      installmentOptions.push({ value: String(i), label: i + 'x' });
    }
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
          <Field label="Forma de Cobrança">
            <NativeSelect
              name="billingMethod"
              placeholder="Selecione a forma de cobrança"
              required
              onValueChange={(value) => {
                setBillingMethod(value);
                if (value === 'PIX') setChargeType('ONE_TIME');
              }}
              options={[
                { value: 'MANUAL_RECEIVED', label: 'Quitado na hora (Manual)' },
                { value: 'BOLETO', label: 'Boleto' },
                { value: 'PIX', label: 'Pix' },
                { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
              ]}
            />
          </Field>

          {billingMethod && (
            <div className="space-y-4">
              <Field label="Taxa de inscrição cobrada">
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">R$</span>
                  <Input
                    name="registrationFeeCharged"
                    type="text"
                    value={feeText}
                    onChange={(event) => setFeeText(formatCurrencyInput(event.target.value))}
                    className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                    required
                  />
                </div>
              </Field>

              <input type="hidden" name="isManual" value={billingMethod === 'MANUAL_RECEIVED' ? 'true' : 'false'} />
              {billingMethod === 'MANUAL_RECEIVED' && (
                <Field label="Forma de recebimento">
                  <NativeSelect
                    name="feePaymentMethod"
                    defaultValue="MANUAL_PIX"
                    options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                  />
                </Field>
              )}

              {billingMethod !== 'MANUAL_RECEIVED' && (
                <>
                  <Field label="Tipo de cobrança">
                    <NativeSelect
                      name="chargeType"
                      defaultValue={billingMethod === 'PIX' ? 'ONE_TIME' : chargeType}
                      onValueChange={(value) => setChargeType(value as ChargeType)}
                      options={
                        billingMethod === 'PIX'
                          ? [{ value: 'ONE_TIME', label: 'À vista' }]
                          : [
                              { value: 'ONE_TIME', label: 'À vista' },
                              { value: 'INSTALLMENT', label: 'Parcelado' },
                            ]
                      }
                    />
                  </Field>

                  <Field label="Vencimento da primeira cobrança">
                    <input type="hidden" name="dueDate" value={dueDate ? dueDate.toISOString().split('T')[0] : ''} />
                    <DatePicker
                      value={dueDate}
                      onChange={setDueDate}
                      variant="input"
                      placeholder="dd/mm/aaaa"
                      className={FILTER_INPUT_CLASS}
                      readOnlyInput
                    />
                  </Field>

                  {chargeType === 'INSTALLMENT' && billingMethod !== 'PIX' && (
                    <Field label="Quantidade de parcelas">
                      <NativeSelect name="installmentCount" defaultValue="2" options={installmentOptions} />
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
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
