import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { parseCurrency } from '@alusa/shared';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { SelectField } from '@/components/forms/SelectField';
import { TextField } from '@/components/primitives/TextField';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileCostumeResourcesResponse } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

type TargetType = 'ALUNO' | 'TURMA';
type BillingMode = 'INCLUDED_IN_REGISTRATION_FEE' | 'SEPARATE_CHARGE' | 'FREE';

export function EventCostumeLinkSheet({
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
  const [data, setData] = useState<MobileCostumeResourcesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costumeId, setCostumeId] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('ALUNO');
  const [targetId, setTargetId] = useState('');
  const [billingMode, setBillingMode] = useState<BillingMode>('INCLUDED_IN_REGISTRATION_FEE');
  const [amountText, setAmountText] = useState('');
  const [definedSize, setDefinedSize] = useState('');
  const [notes, setNotes] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setTargetType('ALUNO');
    setBillingMode('INCLUDED_IN_REGISTRATION_FEE');
    setDefinedSize('');
    setNotes('');
    void eventsService.getCostumeResources(eventId)
      .then((response) => {
        if (!active) return;
        setData(response);
        const firstCostume = response.costumes[0];
        setCostumeId(firstCostume?.id ?? '');
        setAmountText(firstCostume?.chargedValue == null ? '' : toCurrencyText(firstCostume.chargedValue));
        setTargetId(response.resources.alunos[0]?.id ?? response.resources.turmas[0]?.id ?? '');
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os figurinos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [eventId, visible]);

  const selectedCostume = useMemo(() => data?.costumes.find((item) => item.id === costumeId) ?? null, [costumeId, data]);
  const targetOptions = targetType === 'ALUNO' ? data?.resources.alunos ?? [] : data?.resources.turmas ?? [];
  const costumeOptions = (data?.costumes ?? []).map((item) => ({
    value: item.id,
    label: `${item.name}${item.assignmentsCount >= item.quantity ? ' · Sem estoque' : ''}`,
  }));

  function changeCostume(nextId: string) {
    setCostumeId(nextId);
    const next = data?.costumes.find((item) => item.id === nextId);
    setAmountText(next?.chargedValue == null ? '' : toCurrencyText(next.chargedValue));
  }

  function changeTargetType(nextType: TargetType) {
    setTargetType(nextType);
    setTargetId((nextType === 'ALUNO' ? data?.resources.alunos[0]?.id : data?.resources.turmas[0]?.id) ?? '');
  }

  async function submit() {
    if (submittingRef.current) return;
    if (!costumeId) {
      setError('Selecione um figurino.');
      return;
    }
    if (!targetId) {
      setError(`Nenhum ${targetType === 'ALUNO' ? 'aluno inscrito' : 'turma vinculada'} disponível para este evento.`);
      return;
    }
    const amount = parseCurrency(amountText);
    if (billingMode === 'SEPARATE_CHARGE' && amount <= 0) {
      setError('Informe um valor maior que zero para a cobrança separada.');
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await eventsService.createCostumeAssignment(eventId, {
        eventId,
        costumeId,
        alunoId: targetType === 'ALUNO' ? targetId : null,
        turmaId: targetType === 'TURMA' ? targetId : null,
        status: 'PENDING',
        billingMode,
        definedSize: definedSize.trim() || null,
        chargedValue: billingMode === 'FREE' || billingMode === 'INCLUDED_IN_REGISTRATION_FEE' ? null : amount,
        isPaid: false,
        notes: notes.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível vincular o figurino.');
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="92%" accessibilityLabel="Vincular figurino">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headerCopy}>
          <AppText variant="subheading" weight="medium">Vincular figurino</AppText>
          <AppText variant="small" tone="muted">Relacione o figurino a um participante ou turma deste evento.</AppText>
        </View>

        {loading ? <AppText tone="muted">Carregando figurinos...</AppText> : null}
        {error && !data ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}
        {!loading && data && data.costumes.length === 0 ? <View style={styles.emptyBox}><AppText tone="muted">Nenhum figurino cadastrado para este evento.</AppText></View> : null}
        {!loading && data && data.costumes.length > 0 ? (
          <>
            <SelectField label="Figurino" value={selectedCostume?.name ?? 'Selecione um figurino'} selectedValue={costumeId} options={costumeOptions} onValueChange={changeCostume} />

            <SelectField
              label="Vincular a"
              value={targetType === 'ALUNO' ? 'Aluno' : 'Turma'}
              selectedValue={targetType}
              options={[{ value: 'ALUNO', label: 'Aluno' }, { value: 'TURMA', label: 'Turma' }]}
              onValueChange={(value) => changeTargetType(value as TargetType)}
            />

            <SelectField
              label={targetType === 'ALUNO' ? 'Aluno inscrito' : 'Turma vinculada'}
              value={targetOptions.find((item) => item.id === targetId)?.nome ?? 'Selecione'}
              selectedValue={targetId}
              options={targetOptions.map((item) => ({ value: item.id, label: item.nome }))}
              onValueChange={setTargetId}
            />

            <TextField label="Tamanho definido (opcional)" value={definedSize} onChangeText={setDefinedSize} placeholder="Ex.: M" />

            <SelectField
              label="Forma de cobrança"
              value={billingModeLabel(billingMode)}
              selectedValue={billingMode}
              options={[
                { value: 'SEPARATE_CHARGE', label: 'Cobrança separada' },
                { value: 'INCLUDED_IN_REGISTRATION_FEE', label: 'Incluso na matrícula' },
                { value: 'FREE', label: 'Gratuito' },
              ]}
              onValueChange={(value) => setBillingMode(value as BillingMode)}
            />

            {billingMode === 'SEPARATE_CHARGE' ? <TextField label="Valor da cobrança" value={amountText} onChangeText={setAmountText} placeholder="R$ 0,00" keyboardType="decimal-pad" /> : null}
            <TextField label="Observações (opcional)" value={notes} onChangeText={setNotes} placeholder="Ex.: tamanho ou cuidados" multiline style={styles.multilineInput} shellStyle={styles.multilineShell} />
            {error ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}
            <Button title="Vincular figurino" loading={saving} onPress={() => void submit()} />
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function billingModeLabel(value: BillingMode) {
  if (value === 'SEPARATE_CHARGE') return 'Cobrança separada';
  if (value === 'INCLUDED_IN_REGISTRATION_FEE') return 'Incluso na matrícula';
  return 'Gratuito';
}

function toCurrencyText(value: number) {
  return value.toFixed(2).replace('.', ',');
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.sm },
  headerCopy: { gap: spacing.xs },
  multilineShell: { minHeight: 92, alignItems: 'flex-start', paddingVertical: spacing.md },
  multilineInput: { minHeight: 68, textAlignVertical: 'top', paddingTop: 0 },
  errorBox: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  emptyBox: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  pressed: { opacity: 0.78 },
});
