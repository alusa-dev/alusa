import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon } from 'react-native-heroicons/outline';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { SelectField } from '@/components/forms/SelectField';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { billingService } from '@/features/billing/services/billing-service';
import type { BillingCharge } from '@/features/billing/types/billing';
import { currencyAmountToCents, currencyTextToCents, formatCurrencyCents } from '@/features/billing/utils/numeric-inputs';
import { colors, radius, spacing } from '@/theme/tokens';

const paymentOptions = [
  { value: 'PIX' as const, label: 'Pix' },
  { value: 'BOLETO' as const, label: 'Boleto' },
  { value: 'CARTAO_CREDITO' as const, label: 'Cartão de crédito' },
  { value: 'INDEFINIDO' as const, label: 'Pergunte ao cliente' },
];

export default function EditBillingChargeScreen() {
  const { chargeId } = useLocalSearchParams<{ chargeId?: string }>();
  const [charge, setCharge] = useState<BillingCharge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [amountInCents, setAmountInCents] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO'>('BOLETO');

  const loadCharge = useCallback(async () => {
    if (!chargeId) {
      setError('Cobrança não encontrada.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await billingService.getCharge(chargeId);
      if (!response.charge.capabilities.canEdit) {
        setError('Esta cobrança não está mais em aberto e não pode ser editada.');
        return;
      }
      setCharge(response.charge);
      setAmountInCents(currencyAmountToCents(response.charge.amount));
      setDueDate(response.charge.dueDate ? isoToBrazilianDate(response.charge.dueDate) : '');
      setSelectedDate(response.charge.dueDate ? dateFromInput(isoToBrazilianDate(response.charge.dueDate)) ?? nextDate() : nextDate());
      setDescription(response.charge.description);
      setPaymentMethod(normalizePaymentMethod(response.charge.paymentMethod));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a cobrança.');
    } finally {
      setLoading(false);
    }
  }, [chargeId]);

  useEffect(() => { void loadCharge(); }, [loadCharge]);

  const selectedPaymentLabel = useMemo(
    () => paymentOptions.find((option) => option.value === paymentMethod)?.label ?? 'Selecione',
    [paymentMethod],
  );

  const save = async () => {
    if (!chargeId) return;
    const parsedAmount = amountInCents / 100;
    const parsedDueDate = brazilianDateToIso(dueDate);
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
      return;
    }
    if (!parsedDueDate) {
      Alert.alert('Vencimento inválido', 'Informe a data no formato DD/MM/AAAA.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Descrição obrigatória', 'Informe uma descrição para a cobrança.');
      return;
    }
    setSaving(true);
    try {
      const result = await billingService.executeAction(chargeId, 'UPDATE_CHARGE', {
        amount: parsedAmount,
        dueDate: parsedDueDate,
        description: description.trim(),
        paymentMethod,
      });
      Alert.alert('Alteração enviada', result.message, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (saveError) {
      Alert.alert('Não foi possível salvar', saveError instanceof Error ? saveError.message : 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.title}>Editar cobrança</AppText>
      </View>

      {loading ? <EditSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadCharge()} /> : null}
      {!loading && !error && charge ? (
        <View style={styles.content}>
          <View style={styles.statusLine}>
            <View style={[styles.statusDot, { backgroundColor: colorForStatus(charge.category) }]} />
            <AppText weight="medium">{charge.originalStatus}</AppText>
          </View>
          <TextField
            label="Valor"
            value={formatCurrencyCents(amountInCents)}
            selectTextOnFocus
            onChangeText={(value) => setAmountInCents(currencyTextToCents(value))}
            leftIcon={<AppText tone="muted">R$</AppText>}
            inputMode="numeric"
            placeholder="0,00"
          />
          <DateField
            label="Vencimento"
            value={dueDate || 'Selecionar data'}
            onPress={() => { setSelectedDate(dateFromInput(dueDate) ?? nextDate()); setDatePickerVisible(true); }}
          />
          <SelectField
            label="Forma de pagamento"
            value={selectedPaymentLabel}
            selectedValue={paymentMethod}
            options={paymentOptions}
            onValueChange={(value) => {
              const selected = paymentOptions.find((option) => option.value === value);
              if (selected) setPaymentMethod(selected.value);
            }}
          />
          <TextField label="Descrição" value={description} onChangeText={setDescription} placeholder="Descrição da cobrança" maxLength={200} />
          <Button title="Salvar alterações" loading={saving} onPress={() => void save()} />
        </View>
      ) : null}

      {Platform.OS === 'android' && datePickerVisible ? (
        <DateTimePicker value={selectedDate} mode="date" display="default" onChange={handleDateChange} />
      ) : null}
      {Platform.OS === 'ios' ? (
        <DatePickerSheet visible={datePickerVisible} selectedDate={selectedDate} title="Vencimento" buttonVariant="accent" onDateChange={handleDateChange} onClose={() => setDatePickerVisible(false)} onConfirm={() => { setDueDate(dateToBrazilian(selectedDate)); setDatePickerVisible(false); }} />
      ) : null}
    </Screen>
  );

  function handleDateChange(event: DateTimePickerEvent, value?: Date) {
    if (event.type === 'dismissed') {
      setDatePickerVisible(false);
      return;
    }
    if (!value) return;
    setSelectedDate(value);
    if (Platform.OS === 'android') {
      setDueDate(dateToBrazilian(value));
      setDatePickerVisible(false);
    }
  }
}

function EditSkeleton() {
  return <View style={styles.content} accessibilityLabel="Carregando edição da cobrança"><Skeleton width={120} height={20} /><Skeleton width="100%" height={58} radius={radius.md} /><Skeleton width="100%" height={58} radius={radius.md} /><Skeleton width="100%" height={58} radius={radius.md} /><Skeleton width="100%" height={58} radius={radius.md} /></View>;
}

function isoToBrazilianDate(value: string) { const date = new Date(value); return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`; }

function dateFromInput(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? date : null;
}

function dateToBrazilian(value: Date) { return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`; }

function nextDate() { const value = new Date(); value.setHours(12, 0, 0, 0); return value; }

function brazilianDateToIso(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

function normalizePaymentMethod(value: string | null): 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO' {
  switch (value?.toUpperCase()) {
    case 'PIX': return 'PIX';
    case 'CREDIT_CARD':
    case 'CARTAO_CREDITO': return 'CARTAO_CREDITO';
    case 'BOLETO': return 'BOLETO';
    default: return 'INDEFINIDO';
  }
}

function colorForStatus(category: BillingCharge['category']) {
  if (category === 'RECEIVED') return colors.success;
  if (category === 'CONFIRMED') return colors.info;
  if (category === 'AWAITING_PAYMENT') return colors.warning;
  return colors.danger;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  content: { gap: spacing.lg },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusDot: { width: 11, height: 11, borderRadius: radius.pill },
});
