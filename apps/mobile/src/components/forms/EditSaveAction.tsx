import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { PencilSquareIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import { colors, spacing } from '@/theme/tokens';

type EditSaveActionProps = {
  editing: boolean;
  saving?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
};

/** Ação de cabeçalho padronizada para alternar entre editar e salvar. */
export function EditSaveAction({ editing, saving = false, onPress, accessibilityLabel }: EditSaveActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (editing ? 'Salvar alterações' : 'Editar dados')}
      accessibilityState={{ busy: saving, disabled: saving }}
      disabled={saving}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && !saving ? styles.pressed : null]}
    >
      {editing ? (
        <>
          {saving ? <ActivityIndicator color={colors.brand} size="small" /> : null}
          <AppText variant="body" weight="medium" style={styles.saveLabel}>Salvar</AppText>
        </>
      ) : (
        <PencilSquareIcon color={colors.brand} size={22} strokeWidth={1.8} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  saveLabel: {
    color: colors.brand,
  },
  pressed: {
    opacity: 0.7,
  },
});
