import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { SelectField } from '@/components/forms/SelectField';
import { AppText } from '@/components/primitives/AppText';
import type { AgendaFilters, AgendaResources, CalendarEventType } from '../types/agenda';
import { colors, radius, spacing } from '@/theme/tokens';

const eventTypeOptions: Array<{ value: CalendarEventType; label: string }> = [
  { value: 'AULA', label: 'Aula' },
  { value: 'AULA_EXPERIMENTAL', label: 'Aula experimental' },
  { value: 'REPOSICAO', label: 'Reposição' },
  { value: 'EVENTO_INTERNO', label: 'Evento interno' },
  { value: 'EVENTO_EXTERNO', label: 'Evento externo' },
  { value: 'WORKSHOP', label: 'Workshop' },
  { value: 'FERIADO', label: 'Feriado' },
  { value: 'PAUSA', label: 'Pausa' },
  { value: 'CANCELAMENTO', label: 'Cancelamento' },
  { value: 'SUBSTITUICAO', label: 'Substituição' },
];

const allOption = { value: '', label: 'Todos' };

export function AgendaFilterSheet({
  visible,
  filters,
  resources,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: AgendaFilters;
  resources: AgendaResources | null;
  onApply: (_filters: AgendaFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AgendaFilters>(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [filters, visible]);

  const turmaOptions = [allOption, ...(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.label }))];
  const professorOptions = [allOption, ...(resources?.professores ?? []).map((item) => ({ value: item.id, label: item.label }))];
  const salaOptions = [allOption, ...(resources?.salas ?? []).map((item) => ({ value: item.id, label: item.label }))];
  const typeOptions = [allOption, ...eventTypeOptions];

  function update(key: keyof AgendaFilters, value: string) {
    setDraft((current) => ({ ...current, [key]: value || undefined }));
  }

  function clear() {
    setDraft({});
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="88%" accessibilityLabel="Filtros da agenda">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="subheading" weight="medium">Filtrar agenda</AppText>
          <AppText variant="small" tone="muted">Refine a visualização por turma, professor, sala ou tipo.</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Limpar filtros" onPress={clear} hitSlop={8}>
          <AppText variant="small" weight="medium" style={styles.clear}>Limpar</AppText>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SelectField
          label="Turma"
          value={resources?.turmas.find((item) => item.id === draft.turmaId)?.label ?? 'Todas as turmas'}
          selectedValue={draft.turmaId ?? ''}
          options={turmaOptions}
          onValueChange={(value) => update('turmaId', value)}
        />
        <SelectField
          label="Professor"
          value={resources?.professores.find((item) => item.id === draft.professorId)?.label ?? 'Todos os professores'}
          selectedValue={draft.professorId ?? ''}
          options={professorOptions}
          onValueChange={(value) => update('professorId', value)}
        />
        <SelectField
          label="Sala"
          value={resources?.salas.find((item) => item.id === draft.salaId)?.label ?? 'Todas as salas'}
          selectedValue={draft.salaId ?? ''}
          options={salaOptions}
          onValueChange={(value) => update('salaId', value)}
        />
        <SelectField
          label="Tipo de evento"
          value={typeOptions.find((item) => item.value === draft.type)?.label ?? 'Todos os tipos'}
          selectedValue={draft.type ?? ''}
          options={typeOptions}
          onValueChange={(value) => update('type', value)}
        />
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Aplicar filtros"
        onPress={() => {
          onApply(draft);
          onClose();
        }}
        style={({ pressed }) => [styles.apply, pressed ? styles.pressed : null]}
      >
        <AppText weight="bold" style={styles.applyText}>APLICAR FILTROS</AppText>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  clear: { color: colors.brand },
  content: { gap: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  apply: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  applyText: { color: colors.white },
  pressed: { opacity: 0.78 },
});
