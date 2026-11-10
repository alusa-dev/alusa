import { usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';
import { useEffect, useRef } from 'react';

type UnsavedChangesPromptOptions = {
  hasChanges: boolean;
  saving?: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
};

/** Protege formulários mobile contra saída acidental e reaproveita o alerta nativo da plataforma. */
export function useUnsavedChangesPrompt({ hasChanges, saving = false, onSave, onDiscard }: UnsavedChangesPromptOptions) {
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  usePreventRemove(hasChanges && !saving, ({ repeat }) => {
    Alert.alert(
      'Deseja salvar as alterações?',
      'Você fez alterações que ainda não foram salvas.',
      [
        { text: 'Continuar editando', style: 'cancel' },
        {
          text: 'Descartar alterações',
          style: 'destructive',
          onPress: () => {
            onDiscard();
            repeat();
          },
        },
        {
          text: 'Salvar alterações',
          onPress: async () => {
            const saved = await onSaveRef.current();
            if (saved) repeat();
          },
        },
      ],
    );
  });
}
