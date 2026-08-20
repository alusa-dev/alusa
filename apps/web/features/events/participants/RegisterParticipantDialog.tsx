'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';

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
import { InfoCallout } from '@/components/ui/info-callout';

import {
  EventApiError,
  listEventEligibleStudents,
  registerEventParticipant,
  type SchoolEventDTO,
} from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { parseCurrencyInput } from '../shared/event-formatters';
import { ParticipantBillingFields, type ParticipantBillingMethod, type ParticipantChargeType, type ParticipantDiscountType, type ParticipantNotificationChannel } from './ParticipantBillingFields';
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
  const [chargePaymentMethod, setChargePaymentMethod] = useState<'BOLETO' | 'PIX' | 'CREDIT_CARD'>('BOLETO');
  const [chargeType, setChargeType] = useState<ParticipantChargeType>('ONE_TIME');
  const [feeText, setFeeText] = useState('');
  const [discountType, setDiscountType] = useState<ParticipantDiscountType>('FIXED');
  const [discountText, setDiscountText] = useState('');
  const [hasEntry, setHasEntry] = useState(false);
  const [entryText, setEntryText] = useState('');
  const [isFeeExempt, setIsFeeExempt] = useState(false);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [notificationChannels, setNotificationChannels] = useState<ParticipantNotificationChannel[]>([]);
  const [responsaveis, setResponsaveis] = useState<Array<{ id: string; nome: string }>>([]);
  const [responsaveisLoaded, setResponsaveisLoaded] = useState(false);
  const [selectedResponsavelId, setSelectedResponsavelId] = useState('');
  const [groupStudents, setGroupStudents] = useState<Array<{ id: string; nome: string }>>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupResults, setGroupResults] = useState<Array<{ id: string; nome: string; email?: string | null }>>([]);
  const [groupSearchLoading, setGroupSearchLoading] = useState(false);
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
      setDiscountType('FIXED');
      setDiscountText('');
    } else {
      resetAutocomplete();
      setBillingMethod('');
      setChargePaymentMethod('BOLETO');
      setChargeType('ONE_TIME');
      setFeeText('');
      setDiscountType('FIXED');
      setDiscountText('');
      setHasEntry(false);
      setEntryText('');
      setIsFeeExempt(false);
      setDueDate(undefined);
      setNotificationChannels([]);
      setCancelledParticipant(null);
      setResponsaveis([]);
      setResponsaveisLoaded(false);
      setSelectedResponsavelId('');
      setGroupStudents([]);
      setGroupPickerOpen(false);
      setGroupSearch('');
      setGroupResults([]);
    }
  }, [open, event.registrationFee, resetAutocomplete]);

  useEffect(() => {
    if (!open || !selectedStudent?.id) {
      setResponsaveis([]);
      setSelectedResponsavelId('');
      setResponsaveisLoaded(false);
      setGroupStudents([]);
      setGroupPickerOpen(false);
      return;
    }

    let active = true;
    listEventEligibleStudents(eventId, { anchorAlunoId: selectedStudent.id })
      .then((result) => {
        if (!active) return;
        setResponsaveis(result.responsaveis);
        setSelectedResponsavelId(result.selectedResponsavelId ?? result.responsaveis[0]?.id ?? '');
        setResponsaveisLoaded(true);
        setGroupStudents([]);
        setGroupPickerOpen(false);
      })
      .catch(() => {
        if (!active) return;
        setResponsaveis([]);
        setSelectedResponsavelId('');
        setResponsaveisLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [eventId, open, selectedStudent?.id]);

  useEffect(() => {
    if (!groupPickerOpen || !selectedStudent?.id || !selectedResponsavelId || groupSearch.trim().length < 2) {
      setGroupResults([]);
      setGroupSearchLoading(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setGroupSearchLoading(true);
      try {
        const result = await listEventEligibleStudents(eventId, {
          anchorAlunoId: selectedStudent.id,
          responsavelId: selectedResponsavelId,
          q: groupSearch.trim(),
        });
        if (active) setGroupResults(result.items.filter((item) => !groupStudents.some((student) => student.id === item.id)));
      } catch {
        if (active) setGroupResults([]);
      } finally {
        if (active) setGroupSearchLoading(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [eventId, groupPickerOpen, groupSearch, groupStudents, selectedResponsavelId, selectedStudent?.id]);

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
    const registrationFeeOriginal = parseCurrencyInput(String(formData.get('registrationFeeOriginal') || '0'));
    const discountType = String(formData.get('discountType') || 'FIXED') as ParticipantDiscountType;
    const discountValue = discountType === 'FIXED'
      ? parseCurrencyInput(String(formData.get('discountValue') || '0'))
      : Number(String(formData.get('discountValue') || '0').replace(',', '.')) || 0;
    const discountAmount = discountType === 'PERCENTAGE'
      ? Math.min(registrationFeeOriginal, Math.round(registrationFeeOriginal * discountValue) / 100)
      : Math.min(registrationFeeOriginal, discountValue);
    const registrationFeeCharged = Math.max(registrationFeeOriginal - discountAmount, 0);
    const selectedStudentsCount = 1 + groupStudents.length;
    const totalRegistrationFee = registrationFeeCharged * selectedStudentsCount;
    const hasEntry = String(formData.get('hasEntry') || 'false') === 'true';
    const entryAmount = parseCurrencyInput(String(formData.get('entryAmount') || '0'));
    const selectedBillingMode = String(formData.get('billingMethod') || 'MANUAL_RECEIVED');
    const selectedBilling = selectedBillingMode === 'ISSUE_CHARGE'
      ? String(formData.get('chargePaymentMethod') || 'BOLETO')
      : 'MANUAL_RECEIVED';
    const initialPaymentAmount = selectedBilling === 'MANUAL_RECEIVED'
      ? isFeeExempt ? 0 : parseCurrencyInput(String(formData.get('initialPaymentAmount') || '0'))
      : 0;
    const isFeePaid = !isFeeExempt && selectedBilling === 'MANUAL_RECEIVED' && registrationFeeCharged > 0 && initialPaymentAmount >= registrationFeeCharged;
    const feePaymentMethod = selectedBilling === 'MANUAL_RECEIVED'
      ? String(formData.get('feePaymentMethod') || 'OTHER')
      : selectedBilling;
    const entryPaymentMethod = hasEntry ? String(formData.get('entryPaymentMethod') || '') : undefined;
    const notes = String(formData.get('notes') || '');

    const resolvedChargeType = hasEntry ? 'INSTALLMENT' : selectedBilling === 'PIX' ? 'ONE_TIME' : String(formData.get('chargeType') || 'ONE_TIME');
    const dueDateValue = formData.get('dueDate') ? String(formData.get('dueDate')) : undefined;
    if (selectedBilling !== 'MANUAL_RECEIVED' && !dueDateValue) {
      toast.error({ title: 'Aviso', description: 'Por favor, selecione a data de vencimento da primeira cobrança.' });
      return;
    }
    if (hasEntry && (entryAmount <= 0 || entryAmount >= totalRegistrationFee)) {
      toast.error({ title: 'Aviso', description: 'A entrada deve ser maior que zero e menor que a taxa total.' });
      return;
    }
    const installmentCount = resolvedChargeType === 'INSTALLMENT' ? Number(formData.get('installmentCount') || 2) : undefined;

    const payload = {
      alunoId,
      additionalAlunoIds: groupStudents.map((student) => student.id),
      responsavelId: groupStudents.length > 0 ? selectedResponsavelId : undefined,
      uiRequestId: crypto.randomUUID(),
      registrationFeeCharged,
      registrationFeeOriginal,
      discountType,
      discountValue,
      hasEntry,
      entryAmount: hasEntry ? entryAmount : undefined,
      entryPaymentMethod,
      initialPaymentAmount,
      initialPaymentMethod: selectedBilling === 'MANUAL_RECEIVED' ? feePaymentMethod : undefined,
      isFeeExempt,
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
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-6 pr-14 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Inscrever aluno no evento</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-5 text-slate-600">Selecione um aluno cadastrado e especifique a taxa cobrada.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6 [scrollbar-gutter:auto]">
          <Field label="Pesquise um aluno">
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
                className={`${FILTER_INPUT_CLASS} pr-10`}
                placeholder="Busque pelo nome do aluno..."
                required
              />
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
            {selectedStudent && responsaveis.length > 0 && selectedResponsavelId && (
              <p className="text-xs text-slate-500 mt-1">
                Responsável vinculado:{' '}
                <span className="font-semibold text-slate-900">
                  {responsaveis.find((responsavel) => responsavel.id === selectedResponsavelId)?.nome}
                </span>
              </p>
            )}
          </Field>
          {selectedStudent && responsaveis.length > 0 && selectedResponsavelId && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Alunos adicionais na cobrança
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setGroupPickerOpen((current) => !current)}
                disabled={registerMutation.isPending}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Inscrever outro aluno nesta cobrança
              </button>
              {groupStudents.length > 0 && (
                <div className="flex w-full flex-col gap-2">
                  {groupStudents.map((student) => (
                    <span
                      key={student.id}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-[#A94DFF]/35 bg-[#A94DFF]/[0.04] px-3 py-2 text-sm text-slate-700"
                    >
                      <span className="min-w-0 truncate">{student.nome}</span>
                      <button
                        type="button"
                        aria-label={`Remover ${student.nome} da cobrança`}
                        className="rounded-md p-0.5 text-[#7C3AED]/70 transition-colors hover:bg-[#A94DFF]/10 hover:text-[#7C3AED]"
                        onClick={() => setGroupStudents((current) => current.filter((item) => item.id !== student.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {groupPickerOpen && (
                <div className="relative">
                  <Input
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                    placeholder="Busque outro aluno do responsável..."
                    className={`${FILTER_INPUT_CLASS} pr-10`}
                    autoFocus
                  />
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  />
                  {groupSearchLoading && <p className="mt-1 text-xs text-slate-500">Buscando alunos...</p>}
                  {groupSearch.trim().length >= 2 && groupResults.length > 0 && (
                    <AutocompleteList
                      id="event-group-student-suggestions"
                      options={groupResults.map((student) => ({ value: student.id, label: student.nome, description: student.email ?? undefined }))}
                      highlightedIndex={0}
                      onSelect={(option) => {
                        const selected = groupResults.find((student) => student.id === option.value);
                        if (!selected) return;
                        setGroupStudents((current) => [...current, { id: selected.id, nome: selected.nome }]);
                        setGroupSearch('');
                        setGroupPickerOpen(false);
                      }}
                      className="max-h-48 shadow-lg rounded-lg border border-slate-200 bg-white"
                    />
                  )}
                </div>
              )}
            </div>
          )}
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
            chargePaymentMethod={chargePaymentMethod}
            chargeType={chargeType}
            feeText={feeText}
            discountType={discountType}
            discountText={discountText}
            hasEntry={hasEntry}
            entryText={entryText}
            onHasEntryChange={setHasEntry}
            onEntryTextChange={setEntryText}
            dueDate={dueDate}
            onBillingMethodChange={(value) => {
              setBillingMethod(value);
              if (value === 'EXEMPT') {
                setIsFeeExempt(true);
                setEntryText('');
              } else if (value === 'MANUAL_RECEIVED') {
                setIsFeeExempt(false);
              }
            }}
            onChargePaymentMethodChange={setChargePaymentMethod}
            notificationCallout={billingMethod === 'ISSUE_CHARGE' && selectedStudent && responsaveisLoaded ? (
              <InfoCallout variant="info" size="sm" showIcon>
                {responsaveis.length > 0 && selectedResponsavelId
                  ? `Será criada uma cobrança para o responsável financeiro ${responsaveis.find((responsavel) => responsavel.id === selectedResponsavelId)?.nome ?? ''}, com vencimento e acompanhamento financeiro.`
                  : 'Será criada uma cobrança para o próprio aluno, com vencimento e acompanhamento financeiro.'}
              </InfoCallout>
            ) : null}
            onChargeTypeChange={setChargeType}
            onFeeTextChange={setFeeText}
            onDiscountTypeChange={setDiscountType}
            onDiscountTextChange={setDiscountText}
            showManualDiscount
            useBillingModeSelection
            onDueDateChange={setDueDate}
            notificationChannels={notificationChannels}
            onNotificationChannelsChange={setNotificationChannels}
            feeMultiplier={1 + groupStudents.length}
          />
          <Field label="Observações">
            <Textarea name="notes" className="min-h-16 rounded-lg border-slate-200" />
          </Field>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-4">
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
