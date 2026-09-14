import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { SelectField } from '@/components/forms/SelectField';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { billingService } from '@/features/billing/services/billing-service';
import type { BillingCharge } from '@/features/billing/types/billing';
import {
  currencyAmountToCents,
  currencyTextToCents,
  formatCurrencyCents,
  formatPercentageValue,
  normalizePercentageOnBlur,
  parseDecimalInput,
  percentageValidationMessage,
  sanitizePercentageInput,
} from '@/features/billing/utils/numeric-inputs';
import { colors, radius, spacing } from '@/theme/tokens';

const discountOptions = [
  { value: 0, label: 'Até o vencimento' },
  { value: 1, label: '1 dia antes' },
  { value: 3, label: '3 dias antes' },
  { value: 7, label: '7 dias antes' },
  { value: 15, label: '15 dias antes' },
  { value: 30, label: '30 dias antes' },
];

export default function EditBillingRulesScreen() {
  const { chargeId } = useLocalSearchParams<{ chargeId?: string }>();
  const [charge, setCharge] = useState<BillingCharge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [interest, setInterest] = useState('0,00');
  const [interestError, setInterestError] = useState<string>();
  const [fine, setFine] = useState('0,00');
  const [fineError, setFineError] = useState<string>();
  const [discountInCents, setDiscountInCents] = useState(0);
  const [discountPercentage, setDiscountPercentage] = useState('0,00');
  const [discountError, setDiscountError] = useState<string>();
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENTAGE'>('FIXED');
  const [discountLimit, setDiscountLimit] = useState(0);

  const loadCharge = useCallback(async () => {
    if (!chargeId) { setError('Cobrança não encontrada.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await billingService.getCharge(chargeId);
      if (!response.charge.capabilities.canEditRules) {
        setError('Os encargos desta cobrança não podem mais ser alterados.');
        return;
      }
      setCharge(response.charge);
      const rules = response.charge.financialRules;
      setInterest(formatPercentageValue(rules.interestPercent));
      setFine(formatPercentageValue(rules.finePercent));
      const loadedDiscountType = rules.discountType?.toUpperCase().includes('PERCENT') ? 'PERCENTAGE' : 'FIXED';
      if (loadedDiscountType === 'FIXED') {
        setDiscountInCents(currencyAmountToCents(rules.discountValue));
      } else {
        setDiscountPercentage(formatPercentageValue(rules.discountValue));
      }
      setDiscountType(loadedDiscountType);
      setDiscountLimit(rules.discountDueDateLimitDays ?? 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as regras da cobrança.');
    } finally { setLoading(false); }
  }, [chargeId]);

  useEffect(() => { void loadCharge(); }, [loadCharge]);

  const save = async () => {
    if (!chargeId) return;
    const interestValue = parseDecimalInput(interest);
    const fineValue = parseDecimalInput(fine);
    const discountValue = discountType === 'FIXED' ? discountInCents / 100 : parseDecimalInput(discountPercentage);
    if (interestValue === null || fineValue === null || discountValue === null) {
      Alert.alert('Valores inválidos', 'Informe apenas números válidos.');
      return;
    }
    if (interestValue > 100 || fineValue > 100 || (discountType === 'PERCENTAGE' && discountValue > 100)) {
      Alert.alert('Percentual inválido', 'Os percentuais devem estar entre 0,00% e 100,00%.');
      return;
    }
    setSaving(true);
    try {
      const result = await billingService.executeAction(chargeId, 'UPDATE_RULES', {
        interestPercent: interestValue,
        finePercent: fineValue,
        discountValue,
        discountType,
        discountDueDateLimitDays: discountLimit,
      });
      Alert.alert('Alteração enviada', result.message, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (saveError) {
      Alert.alert('Não foi possível salvar', saveError instanceof Error ? saveError.message : 'Tente novamente.');
    } finally { setSaving(false); }
  };

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable>
        <AppText variant="heading" weight="medium" style={styles.title}>Editar encargos</AppText>
      </View>
      {loading ? <RulesSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadCharge()} /> : null}
      {!loading && !error && charge ? (
        <View style={styles.content}>
          <View style={styles.statusLine}><View style={[styles.statusDot, { backgroundColor: colorForStatus(charge.category) }]} /><AppText weight="medium">{charge.originalStatus}</AppText></View>
          <TextField
            label="Juros ao mês"
            value={interest}
            selectTextOnFocus
            onChangeText={(value) => { setInterest(sanitizePercentageInput(value)); setInterestError(undefined); }}
            onBlur={() => { setInterest(normalizePercentageOnBlur(interest)); setInterestError(percentageValidationMessage(interest)); }}
            rightElement={<AppText tone="muted">%</AppText>}
            error={interestError}
            inputMode="decimal"
            maxLength={6}
            placeholder="0,00"
          />
          <TextField
            label="Multa"
            value={fine}
            selectTextOnFocus
            onChangeText={(value) => { setFine(sanitizePercentageInput(value)); setFineError(undefined); }}
            onBlur={() => { setFine(normalizePercentageOnBlur(fine)); setFineError(percentageValidationMessage(fine)); }}
            rightElement={<AppText tone="muted">%</AppText>}
            error={fineError}
            inputMode="decimal"
            maxLength={6}
            placeholder="0,00"
          />
          <View style={styles.fieldGroup}>
            <AppText variant="label" weight="medium" tone="muted">Tipo de desconto</AppText>
            <View style={styles.segmented}><Pressable accessibilityRole="tab" accessibilityState={{ selected: discountType === 'FIXED' }} onPress={() => setDiscountType('FIXED')} style={[styles.segment, discountType === 'FIXED' ? styles.segmentActive : null]}><AppText style={{ color: discountType === 'FIXED' ? colors.brand : colors.ink }}>Valor fixo</AppText></Pressable><Pressable accessibilityRole="tab" accessibilityState={{ selected: discountType === 'PERCENTAGE' }} onPress={() => setDiscountType('PERCENTAGE')} style={[styles.segment, discountType === 'PERCENTAGE' ? styles.segmentActive : null]}><AppText style={{ color: discountType === 'PERCENTAGE' ? colors.brand : colors.ink }}>Percentual</AppText></Pressable></View>
          </View>
          <TextField
            label={discountType === 'FIXED' ? 'Desconto (R$)' : 'Desconto'}
            value={discountType === 'FIXED' ? formatCurrencyCents(discountInCents) : discountPercentage}
            selectTextOnFocus
            onChangeText={(value) => {
              if (discountType === 'FIXED') {
                setDiscountInCents(currencyTextToCents(value));
              } else {
                setDiscountPercentage(sanitizePercentageInput(value));
                setDiscountError(undefined);
              }
            }}
            onBlur={() => {
              if (discountType === 'PERCENTAGE') {
                setDiscountPercentage(normalizePercentageOnBlur(discountPercentage));
                setDiscountError(percentageValidationMessage(discountPercentage));
              }
            }}
            leftIcon={discountType === 'FIXED' ? <AppText tone="muted">R$</AppText> : undefined}
            rightElement={discountType === 'PERCENTAGE' ? <AppText tone="muted">%</AppText> : undefined}
            error={discountType === 'PERCENTAGE' ? discountError : undefined}
            inputMode={discountType === 'FIXED' ? 'numeric' : 'decimal'}
            maxLength={discountType === 'PERCENTAGE' ? 6 : undefined}
            placeholder="0,00"
          />
          <SelectField
            label="Prazo máximo do desconto"
            value={discountOptions.find((option) => option.value === discountLimit)?.label ?? 'Selecione'}
            selectedValue={String(discountLimit)}
            options={discountOptions.map((option) => ({ value: String(option.value), label: option.label }))}
            onValueChange={(value) => {
              const selected = discountOptions.find((option) => String(option.value) === value);
              if (selected) setDiscountLimit(selected.value);
            }}
          />
          <Button title="Salvar alterações" loading={saving} onPress={() => void save()} />
        </View>
      ) : null}
    </Screen>
  );
}

function RulesSkeleton() { return <View style={styles.content} accessibilityLabel="Carregando encargos"><Skeleton width={120} height={20} /><Skeleton width="100%" height={58} radius={radius.md} /><Skeleton width="100%" height={58} radius={radius.md} /><Skeleton width="100%" height={58} radius={radius.md} /></View>; }
function colorForStatus(category: BillingCharge['category']) { if (category === 'RECEIVED') return colors.success; if (category === 'CONFIRMED') return colors.info; if (category === 'AWAITING_PAYMENT') return colors.warning; return colors.danger; }

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  content: { gap: spacing.lg },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusDot: { width: 11, height: 11, borderRadius: radius.pill },
  fieldGroup: { gap: spacing.sm },
  segmented: { minHeight: 52, flexDirection: 'row', padding: 3, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.brandSoft },
});
