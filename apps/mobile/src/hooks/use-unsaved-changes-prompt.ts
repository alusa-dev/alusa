import { useNavigation } from 'expo-router';
import { Alert } from 'react-native';
import { useEffect, useRef } from 'react';

type UnsavedChangesPromptOptions = {
  hasChanges: boolean;
  saving?: boolean;
  onSave: () => Promise<boolean>;
};

/** Protege formulários mobile contra saída acidental e reaproveita o alerta nativo da plataforma. */
export function useUnsavedChangesPrompt({ hasChanges, saving = false, onSave }: UnsavedChangesPromptOptions) {
  const navigation = useNavigation();
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!hasChanges || saving) return undefined;

    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      Alert.alert(
        'Deseja salvar as alterações?',
        'Você fez alterações que ainda não foram salvas.',
        [
          { text: 'Continuar editando', style: 'cancel' },
          {
            text: 'Descartar alterações',
            style: 'destructive',
            onPress: () => navigation.dispatch(event.data.action),
          },
          {
            text: 'Salvar alterações',
            onPress: async () => {
              const saved = await onSaveRef.current();
              if (saved) navigation.dispatch(event.data.action);
            },
          },
        ],
      );
    });
  }, [hasChanges, navigation, saving]);
}
