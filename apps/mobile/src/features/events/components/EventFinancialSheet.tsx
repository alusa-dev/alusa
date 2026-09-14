import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import {
  EVENT_COST_CATEGORIES,
  EVENT_FINANCIAL_STATUS_LABELS,
  EVENT_REVENUE_CATEGORIES,
  parseCurrency,
} from '@alusa/shared';

import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { eventsService } from '@/features/events/services/events-service';
import type {
  EventFinancialEntryType,
  MobileEventFinancialEntry,
} from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import { SelectField } from '@/components/forms/SelectField';
import { SegmentedToggle } from '@/components/forms/SegmentedToggle';
import { currencyTextToCents, formatCurrencyCents } from '@/features/billing/utils/numeric-inputs';

type FinancialType = EventFinancialEntryType;
type FinancialStatus = 'EXPECTED' | 'PENDING' | 'PAID' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

function defaultDate(value?: string | null) {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
}

function toCurrencyText(value: number | null | undefined) {
  return value == null || value <= 0 ? '' : formatCurrencyCents(Math.round(value * 100));
}

function formatMoneyInput(value: string) {
  const cents = currencyTextToCents(value);
  return cents > 0 ? formatCurrencyCents(cents) : '';
}

function realizationLabel(type: FinancialType, realized: boolean) {
  if (!realized) return 'Pendente';
  return type === 'COST' ? 'Pago' : 'Recebida';
}

function realizationDescription(type: FinancialType, realized: boolean) {
  if (realized) return type === 'COST' ? 'O custo já foi quitado.' : 'A receita já foi recebida.';
  return type === 'COST' ? 'O custo ainda aguarda pagamento.' : 'A receita ainda aguarda recebimento.';
}

function statusLabel(value: string) {
  return EVENT_FINANCIAL_STATUS_LABELS[value as keyof typeof EVENT_FINANCIAL_STATUS_LABELS] ?? value;
}

function categoryOptions(type: FinancialType) {
  const categories = type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES.filter((category) => category !== 'Venda de ingresso');
  return categories.map((category) => ({ value: category, label: category }));
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function EventFinancialCreateSheet({
  eventId,
  visible,
  onClose,
  onSaved,
}: {
  eventId: string;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [type, setType] = useState<FinancialType>('COST');
  const [category, setCategory] = useState<string>(EVENT_COST_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [amountText, setAmountText] = useState('');
  const [status, setStatus] = useState<FinancialStatus>('PENDING');
  const [date, setDate] = useState(new Date());
  const [notes, setNotes] = useState('');
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const realized = status === 'PAID' || status === 'RECEIVED';

  const categories = useMemo(() => categoryOptions(type), [type]);

  useEffect(() => {
    if (!visible) return;
    setType('COST');
    setCategory(EVENT_COST_CATEGORIES[0]);
    setDescription('');
    setSupplier('');
    setAmountText('');
    setStatus('PENDING');
    setDate(new Date());
    setNotes('');
    setError(null);
  }, [visible]);

  function changeType(nextType: FinancialType) {
    setType(nextType);
    setCategory(categoryOptions(nextType)[0]?.value ?? '');
    setStatus('PENDING');
  }

  function setRealized(nextRealized: boolean) {
    setStatus(nextRealized ? (type === 'COST' ? 'PAID' : 'RECEIVED') : 'PENDING');
  }

  async function submit() {
    if (submittingRef.current) return;
    const amount = parseCurrency(amountText);
    if (!description.trim()) {
      setError('Informe uma descrição para o lançamento.');
      return;
    }
    if (amount <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    const realized = status === 'PAID' || status === 'RECEIVED';
    const nextStatus = realized ? status : 'PENDING';
    const actualAmount = realized ? amount : null;

    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await eventsService.createFinancialEntry(eventId, {
        type,
        category,
        description: description.trim(),
        supplier: type === 'COST' ? supplier.trim() || null : null,
        expectedAmount: amount,
        actualAmount,
        refundedAmount: 0,
        dueDate: realized ? null : date.toISOString(),
        realizedAt: null,
        status: nextStatus,
        paymentMethod: null,
        notes: notes.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, 'Não foi possível registrar o lançamento.'));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="92%" accessibilityLabel="Registrar custo ou receita">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.sheetContent}
      >
        <View style={styles.headerCopy}>
          <AppText variant="subheading" weight="medium">Registrar custo ou receita</AppText>
          <AppText variant="small" tone="muted">Inclua um lançamento manual para acompanhar o resultado do evento.</AppText>
        </View>

        <SegmentedToggle
          accessibilityLabel="Tipo de lançamento"
          selectedValue={type}
          options={[{ value: 'COST', label: 'Custo' }, { value: 'REVENUE', label: 'Receita' }]}
          onChange={changeType}
        />

        <SelectField
          label="Categoria"
          value={category}
          selectedValue={category}
          options={categories}
          onValueChange={setCategory}
        />
        <TextField label="Nome do lançamento" value={description} onChangeText={setDescription} placeholder={type === 'COST' ? 'Ex.: Locação do espaço' : 'Ex.: Patrocínio'} returnKeyType="next" />
        {type === 'COST' ? <TextField label="Fornecedor (opcional)" value={supplier} onChangeText={setSupplier} placeholder="Nome do fornecedor" returnKeyType="next" /> : null}
        <TextField label={status === 'PAID' || status === 'RECEIVED' ? (type === 'COST' ? 'Valor pago' : 'Valor recebido') : 'Valor previsto'} value={amountText} onChangeText={(value) => setAmountText(formatMoneyInput(value))} placeholder="0,00" keyboardType="decimal-pad" inputMode="numeric" leftIcon={<AppText variant="small" tone="muted">R$</AppText>} />
        <View style={styles.realizedRow}>
          <View style={styles.realizedCopy}>
            <AppText weight="medium">{realizationLabel(type, realized)}</AppText>
            <AppText variant="small" tone="muted">{realizationDescription(type, realized)}</AppText>
          </View>
          <Switch accessibilityLabel={realizationLabel(type, realized)} value={realized} onValueChange={setRealized} trackColor={{ false: colors.border, true: colors.brandSoft }} thumbColor={colors.brand} ios_backgroundColor={colors.border} />
        </View>
        {status === 'PENDING' ? <DateField label="Data prevista" value={dateLabel(date)} onPress={() => setDatePickerVisible(true)} /> : null}
        <TextField label="Descrição (opcional)" value={notes} onChangeText={setNotes} placeholder="Adicione detalhes para este lançamento" multiline style={styles.multilineInput} shellStyle={styles.multilineShell} />
        {error ? <FormError message={error} /> : null}
        <Button title="Registrar lançamento" loading={saving} onPress={() => void submit()} />
      </ScrollView>
      <DatePickerSheet visible={datePickerVisible} selectedDate={date} onDateChange={(_event, value) => value && setDate(value)} onClose={() => setDatePickerVisible(false)} onConfirm={() => setDatePickerVisible(false)} />
    </BottomSheet>
  );
}

export function EventFinancialEditSheet({
  entry,
  eventId,
  visible,
  onClose,
  onSaved,
}: {
  entry: MobileEventFinancialEntry;
  eventId: string;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [category, setCategory] = useState(entry.category);
  const [description, setDescription] = useState(entry.description);
  const [supplier, setSupplier] = useState(entry.supplier ?? '');
  const [amountText, setAmountText] = useState(toCurrencyText(entry.expectedAmount));
  const [status, setStatus] = useState<FinancialStatus>(entry.status as FinancialStatus);
  const [date, setDate] = useState(defaultDate(entry.dueDate));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const realized = status === 'PAID' || status === 'RECEIVED';

  useEffect(() => {
    if (!visible) return;
    setCategory(entry.category);
    setDescription(entry.description);
    setSupplier(entry.supplier ?? '');
    setAmountText(toCurrencyText(entry.actualAmount ?? entry.expectedAmount));
    setStatus(entry.status as FinancialStatus);
    setDate(defaultDate(entry.dueDate));
    setNotes(entry.notes ?? '');
    setError(null);
  }, [entry, visible]);

  async function submit() {
    if (submittingRef.current) return;
    const amount = parseCurrency(amountText);
    if (!description.trim()) {
      setError('Informe uma descrição para o lançamento.');
      return;
    }
    if (amount <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    const realized = status === 'PAID' || status === 'RECEIVED';
    const nextStatus = realized ? status : 'PENDING';
    const actualAmount = realized ? amount : null;

    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await eventsService.updateFinancialEntry(eventId, entry.id, {
        category,
        description: description.trim(),
        supplier: entry.type === 'COST' ? supplier.trim() || null : null,
        expectedAmount: amount,
        actualAmount,
        refundedAmount: 0,
        dueDate: realized ? null : date.toISOString(),
        realizedAt: realized ? entry.realizedAt : null,
        status: nextStatus,
        paymentMethod: null,
        notes: notes.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, 'Não foi possível editar o lançamento.'));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="92%" accessibilityLabel="Editar lançamento">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.sheetContent}
      >
        <View style={styles.headerCopy}>
          <AppText variant="subheading" weight="medium">Editar lançamento</AppText>
          <AppText variant="small" tone="muted">Ajuste o lançamento manual antes de ele ser realizado.</AppText>
        </View>
        <View style={styles.readOnlyType}><AppText variant="small" tone="muted">Tipo</AppText><AppText weight="medium">{entry.type === 'COST' ? 'Custo' : 'Receita'}</AppText></View>
        <SelectField label="Categoria" value={category} selectedValue={category} options={categoryOptions(entry.type)} onValueChange={setCategory} />
        <TextField label="Nome do lançamento" value={description} onChangeText={setDescription} returnKeyType="next" />
        {entry.type === 'COST' ? <TextField label="Fornecedor (opcional)" value={supplier} onChangeText={setSupplier} returnKeyType="next" /> : null}
        <TextField label={status === 'PAID' || status === 'RECEIVED' ? (entry.type === 'COST' ? 'Valor pago' : 'Valor recebido') : 'Valor previsto'} value={amountText} onChangeText={(value) => setAmountText(formatMoneyInput(value))} placeholder="0,00" keyboardType="decimal-pad" inputMode="numeric" leftIcon={<AppText variant="small" tone="muted">R$</AppText>} />
        <View style={styles.realizedRow}>
          <View style={styles.realizedCopy}>
            <AppText weight="medium">{realizationLabel(entry.type, realized)}</AppText>
            <AppText variant="small" tone="muted">{realizationDescription(entry.type, realized)}</AppText>
          </View>
          <Switch accessibilityLabel={realizationLabel(entry.type, realized)} value={realized} onValueChange={(nextValue) => setStatus(nextValue ? (entry.type === 'COST' ? 'PAID' : 'RECEIVED') : 'PENDING')} trackColor={{ false: colors.border, true: colors.brandSoft }} thumbColor={colors.brand} ios_backgroundColor={colors.border} />
        </View>
        {!realized ? <DateField label="Data prevista" value={dateLabel(date)} onPress={() => setDatePickerVisible(true)} /> : null}
        <TextField label="Descrição (opcional)" value={notes} onChangeText={setNotes} multiline style={styles.multilineInput} shellStyle={styles.multilineShell} />
        {error ? <FormError message={error} /> : null}
        <Button title="Salvar alterações" loading={saving} onPress={() => void submit()} />
      </ScrollView>
      <DatePickerSheet visible={datePickerVisible} selectedDate={date} onDateChange={(_event, value) => value && setDate(value)} onClose={() => setDatePickerVisible(false)} onConfirm={() => setDatePickerVisible(false)} />
    </BottomSheet>
  );
}

export function FinancialEntrySummary({ entry }: { entry: MobileEventFinancialEntry }) {
  return (
    <View style={styles.summaryRows}>
      <SummaryRow label="Tipo" value={entry.type === 'COST' ? 'Custo' : 'Receita'} />
      <SummaryRow label="Categoria" value={entry.category} />
      <SummaryRow label="Previsto" value={formatCurrency(entry.expectedAmount)} />
      <SummaryRow label={entry.type === 'COST' ? 'Pago' : 'Recebido'} value={formatCurrency(entry.actualAmount ?? 0)} />
      {entry.refundedAmount > 0 ? <SummaryRow label="Estornado" value={formatCurrency(entry.refundedAmount)} /> : null}
      <SummaryRow label="Status" value={statusLabel(entry.status)} />
      <SummaryRow label="Origem" value={entry.originType === 'MANUAL' ? 'Manual' : 'Automática'} />
      <SummaryRow label={entry.type === 'COST' ? 'Fornecedor' : 'Data prevista'} value={entry.type === 'COST' ? entry.supplier || 'Não informado' : entry.dueDate ? dateLabel(defaultDate(entry.dueDate)) : 'Não informada'} />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><AppText variant="small" tone="muted">{label}</AppText><AppText numberOfLines={2} style={styles.summaryValue}>{value}</AppText></View>;
}

function FormError({ message }: { message: string }) {
  return <View style={styles.errorBox}><AppText variant="small" tone="danger">{message}</AppText></View>;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1, marginHorizontal: -spacing.xl },
  sheetContent: { gap: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing['2xl'] },
  headerCopy: { gap: spacing.xs },
  readOnlyType: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  realizedRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  realizedCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  multilineShell: { minHeight: 92, alignItems: 'flex-start', paddingVertical: spacing.md },
  multilineInput: { minHeight: 68, textAlignVertical: 'top', paddingTop: 0 },
  errorBox: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  summaryRows: { gap: spacing.md },
  summaryRow: { gap: spacing.xs },
  summaryValue: { flexShrink: 1 },
  pressed: { opacity: 0.78 },
});
