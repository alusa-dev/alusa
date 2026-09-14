import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { TextField, type TextFieldProps } from '@/components/primitives/TextField';
import { spacing } from '@/theme/tokens';

type EditableDataFieldProps = TextFieldProps & {
  label: string;
  editing: boolean;
  displayValue?: string | null;
  showInputWhenEditing?: boolean;
};

/** Campo de dados que preserva a leitura limpa e só expõe o input durante a edição. */
export function EditableDataField({ label, editing, displayValue, editable = true, showInputWhenEditing = false, value, ...props }: EditableDataFieldProps) {
  const showInput = editing && (editable !== false || showInputWhenEditing);
  const readableValue = displayValue ?? value?.toString() ?? '';
  const isReadOnlyInput = editing && editable === false && showInputWhenEditing;

  if (!showInput) {
    return (
      <View style={styles.readOnlyField} accessibilityLabel={`${label}: ${readableValue || 'Não informado'}`}>
        <AppText variant="label" weight="medium" tone="muted">{label}</AppText>
        <AppText variant="body" weight="medium" numberOfLines={props.numberOfLines ?? 1} ellipsizeMode="tail">
          {readableValue.trim() || 'Não informado'}
        </AppText>
      </View>
    );
  }

  const input = (
    <TextField
      {...props}
      label={label}
      value={value}
      editable={!isReadOnlyInput}
      focusable={!isReadOnlyInput}
      caretHidden={isReadOnlyInput}
      selectTextOnFocus={!isReadOnlyInput}
    />
  );

  return isReadOnlyInput ? <View pointerEvents="none">{input}</View> : input;
}

const styles = StyleSheet.create({
  readOnlyField: {
    minHeight: 42,
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
