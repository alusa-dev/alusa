import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from 'react-native-heroicons/outline';

import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { ChoiceField } from '@/components/forms/ChoiceField';
import { SelectField } from '@/components/forms/SelectField';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import {
  billingService,
  type BillingPayerCandidate,
  type MobileStandaloneChargeInput,
} from '@/features/billing/services/billing-service';
import {
  currencyTextToCents,
  formatCurrencyCents,
  normalizePercentageOnBlur,
  parseDecimalInput,
  percentageValidationMessage,
  sanitizePercentageInput,
} from '@/features/billing/utils/numeric-inputs';
import { colors, radius, spacing } from '@/theme/tokens';

type ChargeType = 'ONE_TIME' | 'SUBSCRIPTION';
type BillingType = MobileStandaloneChargeInput['billingType'];
type Cycle = NonNullable<MobileStandaloneChargeInput['cycle']>;
type RuleType = 'FIXED' | 'PERCENTAGE';
type DateField = 'dueDate' | 'nextDueDate' | 'endDate';
const TOTAL_STEPS = 5;

const paymentOptionsByType: Record<ChargeType, Array<{ value: BillingType; label: string; description: string }>> = {
  ONE_TIME: [
    { value: 'PIX', label: 'Pix', description: 'Pagamento instantâneo' },
    { value: 'BOLETO', label: 'Boleto bancário', description: 'Compensação em até 1 dia útil' },
    { value: 'CREDIT_CARD', label: 'Cartão de crédito', description: 'Pagamento pelo cartão' },
    { value: 'UNDEFINED', label: 'Cliente escolhe', description: 'O pagador escolhe a forma' },
  ],
  SUBSCRIPTION: [
    { value: 'PIX', label: 'Pix', description: 'Pagamento instantâneo' },
    { value: 'BOLETO', label: 'Boleto bancário', description: 'Compensação em até 1 dia útil' },
    { value: 'CREDIT_CARD', label: 'Cartão de crédito', description: 'Pagamento pelo cartão' },
    { value: 'UNDEFINED', label: 'Cliente escolhe', description: 'O pagador escolhe a forma' },
  ],
};

const cycleOptions: Array<{ value: Cycle; label: string }> = [
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'BIWEEKLY', label: 'Quinzenal' },
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'BIMONTHLY', label: 'Bimestral' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'SEMIANNUALLY', label: 'Semestral' },
  { value: 'YEARLY', label: 'Anual' },
];

const deadlineOptions = [0, 1, 2, 5, 10, 15, 30].map((value) => ({
  value: String(value),
  label: value === 0 ? 'Até o dia do vencimento' : `${value} ${value === 1 ? 'dia' : 'dias'} antes do vencimento`,
}));

export default function CreateBillingScreen() {
  const routeParams = useLocalSearchParams<{
    prefillAmount?: string;
    prefillInstallments?: string;
    prefillBillingType?: string;
    prefillPayerId?: string;
    prefillPayerType?: string;
    prefillPayerName?: string;
    prefillPayerPhoto?: string;
    prefillPayerCpf?: string;
  }>();
  const initialValues = useMemo(() => ({
    amountInCents: parsePrefillAmount(routeParams.prefillAmount),
    installments: parsePrefillInstallments(routeParams.prefillInstallments),
    billingType: parsePrefillBillingType(routeParams.prefillBillingType),
  }), [routeParams.prefillAmount, routeParams.prefillBillingType, routeParams.prefillInstallments]);
  const requestIdRef = useRef<string | null>(null);
  const [step, setStep] = useState(1);
  const [chargeType, setChargeType] = useState<ChargeType>('ONE_TIME');
  const [billingType, setBillingType] = useState<BillingType>(() => initialValues.billingType);
  const [amountInCents, setAmountInCents] = useState(() => initialValues.amountInCents);
  const [installments, setInstallments] = useState(() => initialValues.installments);
  const [dueDate, setDueDate] = useState(() => dateToIso(tomorrowDate()));
  const [nextDueDate, setNextDueDate] = useState(() => dateToIso(tomorrowDate()));
  const [endDate, setEndDate] = useState(() => dateToIso(addYears(tomorrowDate(), 1)));
  const [cycle, setCycle] = useState<Cycle>('MONTHLY');
  const [description, setDescription] = useState('');
  const [interestPercent, setInterestPercent] = useState('');
  const [fineType, setFineType] = useState<RuleType>('PERCENTAGE');
  const [fineValue, setFineValue] = useState('');
  const [discountType, setDiscountType] = useState<RuleType>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [discountDeadlineDays, setDiscountDeadlineDays] = useState(0);
  const [datePickerField, setDatePickerField] = useState<DateField | null>(null);
  const [pickerDate, setPickerDate] = useState(() => tomorrowDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BillingPayerCandidate[]>([]);
  const [searchingPayers, setSearchingPayers] = useState(false);
  const [selectedPayer, setSelectedPayer] = useState<BillingPayerCandidate | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const id = routeParamValue(routeParams.prefillPayerId);
    const name = routeParamValue(routeParams.prefillPayerName);
    const type = routeParamValue(routeParams.prefillPayerType);
    if (!id || !name || (type !== 'aluno' && type !== 'responsavel') || selectedPayer) return;
    setSearchQuery(name);
    const controller = new AbortController();
    setSearchingPayers(true);
    void billingService.searchPayers(name, controller.signal).then((response) => {
      const candidate = response.results.find((item) => item.id === id && item.type === type);
      if (candidate) {
        setSelectedPayer(candidate);
        return;
      }
      setSelectedPayer({
        id,
        name,
        type,
        photo: routeParamValue(routeParams.prefillPayerPhoto) ?? null,
        cpf: routeParamValue(routeParams.prefillPayerCpf) ?? undefined,
        cpfMasked: routeParamValue(routeParams.prefillPayerCpf) ?? null,
        isMinor: false,
        hasResponsible: type === 'aluno',
        responsibleId: null,
        responsibleName: null,
        payerResolved: { type, id, name, hasAsaasCustomerId: false },
        financialStatus: 'INCOMPLETE',
      });
    }).catch(() => {
      if (!controller.signal.aborted) setSelectedPayer(null);
    }).finally(() => {
      if (!controller.signal.aborted) setSearchingPayers(false);
    });
    return () => controller.abort();
  }, [routeParams.prefillPayerCpf, routeParams.prefillPayerId, routeParams.prefillPayerName, routeParams.prefillPayerPhoto, routeParams.prefillPayerType, selectedPayer]);

  const paymentOptions = useMemo(() => paymentOptionsByType[chargeType], [chargeType]);
  const selectedPaymentLabel = paymentOptions.find((option) => option.value === billingType)?.label ?? 'Selecione';
  const selectedCycleLabel = cycleOptions.find((option) => option.value === cycle)?.label ?? 'Selecione';
  const selectedFineTypeLabel = fineType === 'FIXED' ? 'Valor fixo' : 'Percentual';
  const selectedDiscountTypeLabel = discountType === 'FIXED' ? 'Valor fixo' : 'Percentual';
  const selectedDeadlineLabel = deadlineOptions.find((option) => Number(option.value) === discountDeadlineDays)?.label ?? deadlineOptions[0].label;
  const minimumPickerDate = datePickerField === 'endDate' ? dateFromIso(nextDueDate) ?? tomorrowDate() : tomorrowDate();

  useEffect(() => {
    if (chargeType !== 'ONE_TIME' || installments <= 1) return;
    if (billingType === 'PIX' || billingType === 'UNDEFINED') setBillingType('BOLETO');
  }, [billingType, chargeType, installments]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2 || selectedPayer?.name === query) {
      setSearchResults([]);
      setSearchingPayers(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearchingPayers(true);
      try {
        const response = await billingService.searchPayers(query, controller.signal);
        setSearchResults(response.results);
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearchingPayers(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, selectedPayer?.name]);

  const canContinue = useMemo(() => {
    if (step === 1) return selectedPayer?.financialStatus === 'OK';
    if (step === 3) {
      if (amountInCents <= 0 || !billingType) return false;
      if (chargeType === 'SUBSCRIPTION') {
        const firstDueDate = dateFromIso(nextDueDate);
        const subscriptionEndDate = dateFromIso(endDate);
        return Boolean(firstDueDate && subscriptionEndDate && subscriptionEndDate >= firstDueDate && cycle);
      }
      return Boolean(dueDate);
    }
    if (step === 4) {
      return !percentageValidationMessage(interestPercent || '0')
        && !percentageValidationMessage(fineType === 'PERCENTAGE' ? fineValue || '0' : '0')
        && !percentageValidationMessage(discountType === 'PERCENTAGE' ? discountValue || '0' : '0');
    }
    return true;
  }, [amountInCents, billingType, chargeType, discountType, discountValue, dueDate, endDate, fineType, fineValue, interestPercent, nextDueDate, cycle, selectedPayer, step]);

  const openDatePicker = useCallback((field: DateField) => {
    const current = field === 'dueDate' ? dueDate : field === 'nextDueDate' ? nextDueDate : endDate;
    const minimum = field === 'endDate' ? dateFromIso(nextDueDate) ?? tomorrowDate() : tomorrowDate();
    const currentDate = dateFromIso(current) ?? minimum;
    setPickerDate(currentDate < minimum ? minimum : currentDate);
    setDatePickerField(field);
  }, [dueDate, endDate, nextDueDate]);

  const setDateValue = useCallback((field: DateField, value: Date) => {
    const iso = dateToIso(value);
    if (field === 'dueDate') setDueDate(iso);
    if (field === 'nextDueDate') setNextDueDate(iso);
    if (field === 'endDate') setEndDate(iso);
  }, []);

  const handleDateChange = useCallback((event: DateTimePickerEvent, value?: Date) => {
    if (event.type === 'dismissed') {
      setDatePickerField(null);
      return;
    }
    if (!value) return;
    setPickerDate(value);
    if (Platform.OS === 'android' && datePickerField) {
      setDateValue(datePickerField, value);
      setDatePickerField(null);
    }
  }, [datePickerField, setDateValue]);

  const goBack = useCallback(() => {
    if (step > 1) setStep((current) => current - 1);
    else router.back();
  }, [step]);

  function handleNext() {
    if (!canContinue) {
      Alert.alert('Confira os dados', validationMessage(step, { amountInCents, chargeType, dueDate, endDate, nextDueDate, selectedPayer }));
      return;
    }
    if (step < TOTAL_STEPS) setStep((current) => current + 1);
    else void submit();
  }

  async function submit() {
    if (submitting || !selectedPayer || selectedPayer.financialStatus !== 'OK') return;

    const idempotencyKey = requestIdRef.current ?? createRequestId();
    requestIdRef.current = idempotencyKey;
    const isInstallment = chargeType === 'ONE_TIME' && installments > 1;
    const normalizedChargeType = isInstallment ? 'INSTALLMENT' : chargeType;
    const parsedInterest = parseDecimalInput(interestPercent);
    const parsedFine = parseDecimalInput(fineValue);
    const parsedDiscount = discountType === 'FIXED'
      ? currencyTextToCents(discountValue) / 100
      : parseDecimalInput(discountValue);

    const payload: MobileStandaloneChargeInput = {
      payer: selectedPayer.type === 'aluno'
        ? { type: 'aluno', alunoId: selectedPayer.id }
        : { type: 'responsavel', responsavelId: selectedPayer.id },
      chargeType: normalizedChargeType,
      billingType,
      description: description.trim() || undefined,
      uiRequestId: idempotencyKey,
    };

    if (normalizedChargeType === 'INSTALLMENT') {
      payload.installmentCount = installments;
      payload.installmentValue = Number(((amountInCents / 100) / installments).toFixed(2));
      payload.dueDate = dueDate;
    } else if (normalizedChargeType === 'SUBSCRIPTION') {
      payload.value = amountInCents / 100;
      payload.nextDueDate = nextDueDate;
      payload.cycle = cycle;
      payload.endDate = endDate;
    } else {
      payload.value = amountInCents / 100;
      payload.dueDate = dueDate;
    }

    if (parsedInterest !== null && parsedInterest > 0) payload.interest = { value: parsedInterest };
    if (parsedFine !== null && parsedFine > 0) payload.fine = { value: fineType === 'FIXED' ? parsedFine : parsedFine, type: fineType };
    if (parsedDiscount !== null && parsedDiscount > 0) {
      payload.discount = { value: parsedDiscount, type: discountType, dueDateLimitDays: discountDeadlineDays };
    }

    setSubmitting(true);
    try {
      const result = await billingService.createStandaloneCharge(payload);
      Alert.alert(
        result.pending ? 'Cobrança em processamento' : 'Cobrança criada',
        result.pending
          ? 'Recebemos os dados e estamos finalizando a cobrança. Ela aparecerá na lista assim que estiver pronta. Você não precisa repetir a operação.'
          : 'A cobrança foi criada com sucesso e já está disponível para acompanhamento.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Não foi possível criar', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={step > 1 ? 'Voltar para etapa anterior' : 'Voltar'} hitSlop={10} onPress={goBack} style={styles.headerButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Criar cobrança</AppText>
        <View style={styles.headerButton} />
      </View>

      {step === 1 ? (
        <View style={styles.stepContent}>
          <SectionHeading title="Quem você irá cobrar?" description="Selecione um aluno maior de idade ou responsável financeiro cadastrado." />
          <TextField label="Buscar pagador" value={searchQuery} onChangeText={(value) => { setSearchQuery(value); if (selectedPayer && value !== selectedPayer.name) setSelectedPayer(null); }} placeholder="Nome ou CPF" leftIcon={<MagnifyingGlassIcon color={colors.inkMuted} size={21} strokeWidth={1.8} />} rightElement={searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca de pagador" onPress={() => { setSearchQuery(''); setSelectedPayer(null); }}><XMarkIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable> : undefined} />
          {selectedPayer ? <SelectedPayerCard payer={selectedPayer} onClear={() => { setSelectedPayer(null); setSearchQuery(''); }} /> : null}
          {searchingPayers ? <AppText variant="small" tone="muted">Buscando pagadores...</AppText> : null}
          {!selectedPayer && searchResults.length > 0 ? <View style={styles.payerResults}>{searchResults.map((payer) => <PayerResultRow key={`${payer.type}:${payer.id}`} payer={payer} onSelect={() => { if (payer.financialStatus !== 'OK') return; setSelectedPayer(payer); setSearchQuery(payer.name); setSearchResults([]); }} />)}</View> : null}
          {!selectedPayer && searchQuery.trim().length >= 2 && !searchingPayers && searchResults.length === 0 ? <EmptyPayerSearch /> : null}
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepContent}>
          <SectionHeading title="Meu cliente irá pagar" description="Escolha o tipo de cobrança que será criado." />
          <ChoiceField selected={chargeType === 'ONE_TIME'} onPress={() => setChargeType('ONE_TIME')} title="À vista ou parcelado" description="Uma cobrança única, com opção de dividir o valor em parcelas." icon={BanknotesIcon} />
          <ChoiceField selected={chargeType === 'SUBSCRIPTION'} onPress={() => setChargeType('SUBSCRIPTION')} title="Assinatura" description="Cobranças recorrentes com frequência e valor definidos." icon={CalendarDaysIcon} />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepContent}>
          <SectionHeading title="Dados da cobrança" description="Defina como e quando o cliente poderá pagar." />
          <SelectField label="Forma de pagamento" value={selectedPaymentLabel} selectedValue={billingType} options={paymentOptions} onValueChange={(value) => { const selected = paymentOptions.find((option) => option.value === value); if (selected) setBillingType(selected.value); }} />

          <TextField label={chargeType === 'SUBSCRIPTION' ? 'Valor por ciclo' : 'Valor total da cobrança'} value={amountInCents ? formatCurrencyCents(amountInCents) : ''} placeholder="0,00" leftIcon={<AppText variant="small" tone="muted">R$</AppText>} inputMode="numeric" selectTextOnFocus onChangeText={(value) => setAmountInCents(currencyTextToCents(value))} />

          {chargeType === 'SUBSCRIPTION' ? (
            <>
              <SelectField label="Frequência da cobrança" value={selectedCycleLabel} selectedValue={cycle} options={cycleOptions} onValueChange={(value) => { const selected = cycleOptions.find((option) => option.value === value); if (selected) setCycle(selected.value); }} />
              <DateField label="Vencimento da 1ª cobrança" value={formatDateBR(nextDueDate)} onPress={() => openDatePicker('nextDueDate')} />
              <DateField label="Fim da assinatura" value={formatDateBR(endDate)} onPress={() => openDatePicker('endDate')} />
            </>
          ) : (
            <>
              <SelectField label="Parcelamento" value={installmentLabel(amountInCents, installments)} selectedValue={String(installments)} options={Array.from({ length: 24 }, (_, index) => index + 1).map((count) => ({ value: String(count), label: installmentLabel(amountInCents, count) }))} onValueChange={(value) => setInstallments(Number(value))} />
              <DateField label="Vencimento da cobrança" value={formatDateBR(dueDate)} onPress={() => openDatePicker('dueDate')} />
            </>
          )}

          <TextField label="Descrição (opcional)" value={description} onChangeText={setDescription} placeholder="Ex.: Mensalidade de setembro" maxLength={500} multiline style={styles.descriptionInput} />
          <AppText variant="tiny" tone="subtle" style={styles.counter}>{description.length}/500</AppText>
        </View>
      ) : null}

      {step === 4 ? (
        <View style={styles.stepContent}>
          <SectionHeading title="Aplicar multas e juros?" description="Essas regras serão enviadas junto com a cobrança." />
          <RuleSection title="Juros ao mês">
            <TextField label="Percentual" value={interestPercent} onChangeText={(value) => setInterestPercent(sanitizePercentageInput(value))} onBlur={() => setInterestPercent(normalizePercentageOnBlur(interestPercent))} placeholder="0,00" inputMode="decimal" rightElement={<AppText variant="small" tone="muted">%</AppText>} />
          </RuleSection>
          <RuleSection title="Multa">
            <SelectField label="Tipo da multa" value={selectedFineTypeLabel} selectedValue={fineType} options={[{ value: 'PERCENTAGE', label: 'Percentual' }, { value: 'FIXED', label: 'Valor fixo' }]} onValueChange={(value) => { if (value === 'PERCENTAGE' || value === 'FIXED') setFineType(value); }} />
            <TextField label={fineType === 'FIXED' ? 'Valor (R$)' : 'Percentual'} value={fineValue} onChangeText={(value) => setFineValue(fineType === 'FIXED' ? formatCurrencyText(value) : sanitizePercentageInput(value))} onBlur={() => { if (fineType === 'PERCENTAGE') setFineValue(normalizePercentageOnBlur(fineValue)); }} placeholder="0,00" inputMode={fineType === 'FIXED' ? 'numeric' : 'decimal'} leftIcon={fineType === 'FIXED' ? <AppText variant="small" tone="muted">R$</AppText> : undefined} rightElement={fineType === 'PERCENTAGE' ? <AppText variant="small" tone="muted">%</AppText> : undefined} />
          </RuleSection>
          <RuleSection title="Desconto para pagamento antecipado">
            <SelectField label="Tipo do desconto" value={selectedDiscountTypeLabel} selectedValue={discountType} options={[{ value: 'PERCENTAGE', label: 'Percentual' }, { value: 'FIXED', label: 'Valor fixo' }]} onValueChange={(value) => { if (value === 'PERCENTAGE' || value === 'FIXED') setDiscountType(value); }} />
            <TextField label={discountType === 'FIXED' ? 'Valor do desconto (R$)' : 'Percentual de desconto'} value={discountValue} onChangeText={(value) => setDiscountValue(discountType === 'FIXED' ? formatCurrencyText(value) : sanitizePercentageInput(value))} onBlur={() => { if (discountType === 'PERCENTAGE') setDiscountValue(normalizePercentageOnBlur(discountValue)); }} placeholder="0,00" inputMode={discountType === 'FIXED' ? 'numeric' : 'decimal'} leftIcon={discountType === 'FIXED' ? <AppText variant="small" tone="muted">R$</AppText> : undefined} rightElement={discountType === 'PERCENTAGE' ? <AppText variant="small" tone="muted">%</AppText> : undefined} />
            <SelectField label="Prazo máximo do desconto" value={selectedDeadlineLabel} selectedValue={String(discountDeadlineDays)} options={deadlineOptions} onValueChange={(value) => setDiscountDeadlineDays(Number(value))} />
          </RuleSection>
        </View>
      ) : null}

      {step === 5 ? (
        <View style={styles.stepContent}>
          <SectionHeading title="Revise antes de criar" description="Confira os dados antes de criar. Depois, você poderá acompanhar o andamento e o status da cobrança." />
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeader}><AppText variant="subheading" weight="medium">Resumo da cobrança</AppText><BanknotesIcon color={colors.brand} size={22} strokeWidth={1.8} /></View>
            <SummaryRow label="Pagador" value={selectedPayer?.name ?? 'Não selecionado'} />
            <SummaryRow label="Tipo" value={chargeType === 'SUBSCRIPTION' ? `Assinatura · ${selectedCycleLabel}` : installments > 1 ? `Parcelada · ${installments}x` : 'À vista'} />
            <SummaryRow label="Valor" value={formatCurrencyCents(amountInCents)} />
            <SummaryRow label="Forma de pagamento" value={selectedPaymentLabel} />
            <SummaryRow label={chargeType === 'SUBSCRIPTION' ? 'Primeiro vencimento' : 'Vencimento'} value={formatDateBR(chargeType === 'SUBSCRIPTION' ? nextDueDate : dueDate)} />
            {description.trim() ? <SummaryRow label="Descrição" value={description.trim()} /> : null}
          </View>
          <View style={styles.reviewNotice}><CheckCircleIcon color={colors.success} size={20} strokeWidth={1.8} /><AppText variant="small" tone="muted" style={styles.flexCopy}>A cobrança pode levar alguns instantes para aparecer atualizada. O status será atualizado automaticamente.</AppText></View>
        </View>
      ) : null}

      <View style={styles.footer}><Button title={step === TOTAL_STEPS ? 'Criar cobrança' : 'Continuar'} loading={submitting} disabled={!canContinue} onPress={handleNext} /></View>

      {Platform.OS === 'android' && datePickerField ? <DateTimePicker value={pickerDate} minimumDate={minimumPickerDate} mode="date" display="default" onChange={handleDateChange} /> : null}
      {Platform.OS === 'ios' ? (
        <DatePickerSheet visible={datePickerField !== null} minimumDate={minimumPickerDate} selectedDate={pickerDate} onDateChange={handleDateChange} onClose={() => setDatePickerField(null)} onConfirm={() => { if (datePickerField) setDateValue(datePickerField, pickerDate); setDatePickerField(null); }} />
      ) : null}
    </Screen>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <View style={styles.headingBlock}><AppText variant="subheading" weight="medium">{title}</AppText><View style={styles.headingRule} /><AppText variant="small" tone="muted">{description}</AppText></View>;
}

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.ruleSection}><AppText variant="body" weight="medium">{title}</AppText>{children}</View>;
}

function PayerResultRow({ payer, onSelect }: { payer: BillingPayerCandidate; onSelect: () => void }) {
  const available = payer.financialStatus === 'OK';
  return <Pressable disabled={!available} accessibilityRole="button" accessibilityState={{ disabled: !available }} onPress={onSelect} style={({ pressed }) => [styles.payerRow, !available ? styles.payerRowDisabled : null, pressed ? styles.pressed : null]}><StudentAvatar name={payer.name} photo={payer.photo ?? null} size={42} /><View style={styles.flexCopy}><AppText weight="medium">{payer.name}</AppText><AppText variant="small" tone="muted">{payer.type === 'aluno' ? 'Aluno' : 'Responsável'}{payer.cpfMasked ? ` · ${payer.cpfMasked}` : ''}</AppText>{!available ? <AppText variant="tiny" tone="danger">Cadastro financeiro incompleto</AppText> : null}</View>{available ? <ChevronDownIcon color={colors.inkMuted} size={18} strokeWidth={1.8} style={styles.rotatedChevron} /> : null}</Pressable>;
}

function SelectedPayerCard({ payer, onClear }: { payer: BillingPayerCandidate; onClear: () => void }) {
  return <View style={styles.selectedPayer}><View style={styles.selectedPayerIcon}><CheckCircleIcon color={colors.success} size={22} strokeWidth={1.8} /></View><View style={styles.flexCopy}><AppText weight="medium">{payer.name}</AppText><AppText variant="small" tone="muted">Pagador selecionado · {payer.type === 'aluno' ? 'Aluno' : 'Responsável'}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Trocar pagador" onPress={onClear}><AppText variant="small" weight="medium" style={{ color: colors.brand }}>Trocar</AppText></Pressable></View>;
}

function EmptyPayerSearch() {
  return <View style={styles.emptyPayer}><AppText weight="medium">Nenhum pagador encontrado</AppText><AppText variant="small" tone="muted">Tente buscar por nome ou CPF de um aluno maior de idade ou responsável financeiro.</AppText></View>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><AppText variant="small" tone="muted">{label}</AppText><AppText variant="small" weight="medium" style={styles.summaryValue}>{value}</AppText></View>;
}

function installmentLabel(amountInCents: number, installments: number) {
  if (installments === 1) return `À vista · ${formatCurrencyCents(amountInCents)}`;
  return `${installments}x de ${formatCurrencyCents(Math.round(amountInCents / installments))}`;
}

function validationMessage(step: number, values: { amountInCents: number; chargeType: ChargeType; dueDate: string; nextDueDate: string; endDate: string; selectedPayer: BillingPayerCandidate | null }) {
  if (step === 3 && values.amountInCents <= 0) return 'Informe um valor maior que zero.';
  if (step === 3 && values.chargeType === 'SUBSCRIPTION' && (!values.nextDueDate || !values.endDate || (dateFromIso(values.endDate)?.getTime() ?? 0) < (dateFromIso(values.nextDueDate)?.getTime() ?? 0))) return 'O fim da assinatura deve ser igual ou posterior ao primeiro vencimento.';
  if (step === 3 && values.chargeType === 'ONE_TIME' && !values.dueDate) return 'Informe o vencimento da cobrança.';
  if (step === 1 && !values.selectedPayer) return 'Busque e selecione um pagador com cadastro financeiro completo.';
  return 'Revise os campos obrigatórios para continuar.';
}

function formatCurrencyText(value: string) {
  return value.replace(/\D/g, '') ? formatCurrencyCents(currencyTextToCents(value)) : '';
}

function routeParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePrefillAmount(value: string | string[] | undefined) {
  const parsed = Number(routeParamValue(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 100_000_000) : 0;
}

function parsePrefillInstallments(value: string | string[] | undefined) {
  const parsed = Number(routeParamValue(value));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 ? parsed : 1;
}

function parsePrefillBillingType(value: string | string[] | undefined): BillingType {
  const parsed = routeParamValue(value);
  return parsed === 'BOLETO' || parsed === 'PIX' || parsed === 'CREDIT_CARD' || parsed === 'UNDEFINED' ? parsed : 'PIX';
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function tomorrowDate() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(12, 0, 0, 0);
  return value;
}

function addYears(value: Date, years: number) {
  const result = new Date(value);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function dateToIso(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function formatDateBR(value: string) {
  const date = dateFromIso(value);
  return date ? `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}` : 'Selecionar data';
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  stepContent: { gap: spacing.lg },
  headingBlock: { gap: spacing.sm },
  headingRule: { height: 1, backgroundColor: colors.border },
  descriptionInput: { minHeight: 84, paddingTop: spacing.md, paddingBottom: spacing.md, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', marginTop: -spacing.md },
  ruleSection: { gap: spacing.md, paddingTop: spacing.sm },
  footer: { paddingTop: spacing.sm },
  payerResults: { gap: spacing.sm },
  payerRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  payerRowDisabled: { opacity: 0.62 },
  selectedPayer: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSoft },
  selectedPayerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  emptyPayer: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  flexCopy: { flex: 1, gap: spacing.xs },
  reviewCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryRow: { gap: spacing.xs },
  summaryValue: { color: colors.ink },
  reviewNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  rotatedChevron: { transform: [{ rotate: '-90deg' }] },
  pressed: { opacity: 0.76 },
});
