import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export type FilterOption = { value: string; label: string; description?: string };

type FilterOptionSheetProps = {
  visible: boolean;
  title: string;
  value: string;
  clearValue: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  onClose: () => void;
  accessibilityLabel?: string;
};

export function FilterOptionSheet({ visible, title, value, clearValue, options, onChange, onClose, accessibilityLabel = 'Filtros' }: FilterOptionSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={accessibilityLabel}>
      <View style={styles.header}>
        <AppText variant="subheading" weight="medium">{title}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Limpar filtros" onPress={() => { onChange(clearValue); onClose(); }}>
          <AppText variant="small" weight="medium" style={styles.clear}>Limpar</AppText>
        </Pressable>
      </View>
      <View style={styles.options} accessibilityRole="radiogroup">
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => { onChange(option.value); onClose(); }}
              style={({ pressed }) => [styles.option, index > 0 ? styles.optionDivider : null, pressed ? styles.pressed : null]}
            >
              <View style={styles.copy}>
                <AppText weight="medium">{option.label}</AppText>
                {option.description ? <AppText variant="small" tone="muted">{option.description}</AppText> : null}
              </View>
              <View style={[styles.radio, selected ? styles.radioSelected : null]}>{selected ? <View style={styles.radioDot} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  clear: { color: colors.brand },
  options: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  option: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  optionDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  copy: { flex: 1, gap: spacing.xs },
  radio: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.inkSubtle, borderRadius: radius.pill },
  radioSelected: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.brand },
  pressed: { opacity: 0.76 },
});
