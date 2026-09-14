import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  CreditCardIcon,
  InformationCircleIcon,
} from 'react-native-heroicons/outline';

import { ChoiceField } from '@/components/forms/ChoiceField';
import { SelectField } from '@/components/forms/SelectField';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import {
  billingService,
  type PaymentSimulationResult,
} from '@/features/billing/services/billing-service';
import { currencyTextToCents, formatCurrencyCents } from '@/features/billing/utils/numeric-inputs';
import { colors, radius, spacing } from '@/theme/tokens';

type ReceiveMode = 'fast' | 'scheduled';
type SimulationStatus = 'idle' | 'loading' | 'success' | 'error';

const installmentOptions = Array.from({ length: 21 }, (_, index) => index + 1);
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function SimulatorScreen() {
  const [amountInCents, setAmountInCents] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('fast');
  const [passFees, setPassFees] = useState(false);
  const [status, setStatus] = useState<SimulationStatus>('idle');
  const [result, setResult] = useState<PaymentSimulationResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const amount = useMemo(() => amountInCents / 100, [amountInCents]);
  const amountError = submitted && amountInCents < 500
    ? 'O valor mínimo para uma cobrança no cartão é R$ 5,00.'
    : undefined;
  const canSimulate = amountInCents >= 500 && status !== 'loading';

  async function handleSimulate() {
    setSubmitted(true);
    if (!canSimulate) return;

    setStatus('loading');
    setResult(null);
    try {
      const response = await billingService.simulatePayment({
        value: amount,
        installmentCount: installments,
        passFees,
      });
      setResult(response.data);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  function handleCreateCharge() {
    if (!result) return;

    router.push({
      pathname: '/(app)/billing/create',
      params: {
        prefillAmount: String(Math.round(result.chargeValue * 100)),
        prefillInstallments: String(result.installmentCount),
        prefillBillingType: 'CREDIT_CARD',
      },
    });
  }

  function handleNewSimulation() {
    setStatus('idle');
    setResult(null);
    setSubmitted(false);
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Simular venda</AppText>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.infoBox}>
        <InformationCircleIcon color={colors.brand} size={22} strokeWidth={1.8} />
        <AppText variant="small" tone="muted" style={styles.flexCopy}>
          Veja uma estimativa do valor que você pode receber antes de criar uma cobrança. A simulação não cria nenhuma cobrança.
        </AppText>
      </View>

      {!result ? (
        <View style={styles.content}>
          <View style={styles.introduction}>
            <AppText variant="subheading" weight="medium">{passFees ? 'Quanto você quer receber?' : 'Quanto você quer cobrar?'}</AppText>
            <AppText variant="small" tone="muted">Informe o valor e escolha como deseja acompanhar o recebimento.</AppText>
          </View>

          <TextField
            label={passFees ? 'Valor que você quer receber' : 'Total a cobrar'}
            value={amountInCents ? formatCurrencyCents(amountInCents) : ''}
            placeholder="0,00"
            inputMode="numeric"
            selectTextOnFocus
            error={amountError}
            leftIcon={<AppText variant="small" tone="muted">R$</AppText>}
            onChangeText={(value) => {
              setAmountInCents(currencyTextToCents(value));
              if (status === 'error') setStatus('idle');
            }}
          />

          <SelectField
            label="Número de parcelas"
            value={installmentLabel(installments)}
            selectedValue={String(installments)}
            options={installmentOptions.map((option) => ({ value: String(option), label: installmentLabel(option) }))}
            onValueChange={(value) => setInstallments(Number(value))}
          />

          <View style={styles.section}>
            <AppText variant="body" weight="medium">Quero receber</AppText>
            <ChoiceField
              selected={receiveMode === 'fast'}
              onPress={() => setReceiveMode('fast')}
              title="A parcela em até 2 dias"
              description="Receba mais rápido, conforme a disponibilidade da conta."
              icon={CreditCardIcon}
            />
            <ChoiceField
              selected={receiveMode === 'scheduled'}
              onPress={() => setReceiveMode('scheduled')}
              title="Uma parcela a cada 32 dias"
              description="Receba acompanhando o prazo de cada parcela."
              icon={BanknotesIcon}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.flexCopy}>
              <AppText variant="body" weight="medium">Repassar taxas ao cliente</AppText>
              <AppText variant="small" tone="muted">O valor da cobrança será ajustado para preservar o valor que você deseja receber.</AppText>
            </View>
            <Switch
              accessibilityLabel="Repassar taxas ao cliente"
              value={passFees}
              onValueChange={setPassFees}
              trackColor={{ false: colors.border, true: colors.brandSoft }}
              thumbColor={passFees ? colors.brand : colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          {status === 'error' ? (
            <View style={styles.errorBox}>
              <AppText variant="small" tone="danger" weight="medium">Não foi possível calcular a estimativa.</AppText>
              <AppText variant="small" tone="muted">Confira sua conexão e tente novamente.</AppText>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Button title={status === 'loading' ? 'Calculando' : 'Simular'} loading={status === 'loading'} disabled={!canSimulate} onPress={() => void handleSimulate()} />
          </View>
        </View>
      ) : (
        <SimulationResult
          result={result}
          receiveMode={receiveMode}
          onCreateCharge={handleCreateCharge}
          onNewSimulation={handleNewSimulation}
        />
      )}
    </Screen>
  );
}

function SimulationResult({ result, receiveMode, onCreateCharge, onNewSimulation }: { result: PaymentSimulationResult; receiveMode: ReceiveMode; onCreateCharge: () => void; onNewSimulation: () => void }) {
  const installmentLabel = result.installmentCount === 1
    ? `1 parcela de ${formatCurrency(result.installmentValue)}`
    : `${result.installmentCount} parcelas de ${formatCurrency(result.installmentValue)}`;

  return (
    <View style={styles.content}>
      <View style={styles.resultHeading}>
        <AppText variant="subheading" weight="medium">Confira a estimativa</AppText>
        <AppText variant="small" tone="muted">Veja o que seu cliente paga e quanto chega para você.</AppText>
      </View>

      <View style={styles.resultCard}>
        <AppText variant="body" weight="medium">Seu cliente paga</AppText>
        <ResultRow label="Valor da cobrança" value={formatCurrency(result.chargeValue)} emphasis />
        <ResultRow label="Parcelas" value={installmentLabel} />
        <View style={styles.divider} />
        <AppText variant="body" weight="medium">Quanto você recebe</AppText>
        <AppText variant="display" weight="medium" style={styles.resultValue}>{formatCurrency(result.netValue)}</AppText>
        <AppText variant="small" tone="muted">Valor estimado após as taxas</AppText>
        <View style={styles.resultRows}>
          <ResultRow label="Taxa estimada" value={formatCurrency(result.feeValue)} />
          <ResultRow label="Taxa do pagamento" value={formatPercent(result.feePercentage)} />
          {result.operationFee !== null ? <ResultRow label="Tarifa fixa" value={formatCurrency(result.operationFee)} /> : null}
          <ResultRow label="Forma de recebimento" value={receiveMode === 'fast' ? 'Mais rápido' : 'Conforme as parcelas'} />
        </View>
      </View>

      <View style={styles.resultNotice}>
        <InformationCircleIcon color={colors.brand} size={19} strokeWidth={1.8} />
        <AppText variant="tiny" tone="muted" style={styles.flexCopy}>O valor final pode variar conforme as condições da cobrança no momento da criação.</AppText>
      </View>

      <View style={styles.footer}>
        <Button title="Criar cobrança" onPress={onCreateCharge} />
        <Pressable accessibilityRole="button" onPress={onNewSimulation} style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}>
          <AppText weight="medium" style={styles.secondaryButtonText}>Ajustar simulação</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function ResultRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.resultRow}>
      <AppText variant="small" tone="muted">{label}</AppText>
      <AppText variant="small" weight={emphasis ? 'medium' : 'regular'}>{value}</AppText>
    </View>
  );
}

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.max(0, value));
}

function formatPercent(value: number | null) {
  return value === null ? 'Conforme as condições' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  content: { gap: spacing.lg },
  introduction: { gap: spacing.xs },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSoft },
  flexCopy: { flex: 1 },
  section: { gap: spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  errorBox: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  footer: { gap: spacing.md, paddingTop: spacing.sm },
  resultHeading: { gap: spacing.xs },
  resultCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  resultValue: { color: colors.brand, marginTop: spacing.sm },
  resultRows: { gap: spacing.xs, marginTop: spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 26 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  resultNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSoft },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  secondaryButtonText: { color: colors.brand },
  pressed: { opacity: 0.76 },
});

function installmentLabel(value: number) {
  return value === 1 ? '1 parcela (à vista)' : `${value} parcelas`;
}
