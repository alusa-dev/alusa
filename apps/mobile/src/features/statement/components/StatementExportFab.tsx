import { Alert } from 'react-native';
import { DocumentIcon, DocumentTextIcon } from 'react-native-heroicons/outline';

import { FloatingActionMenu } from '@/components/overlays/FloatingActionMenu';

const exportActions = [
  { key: 'excel', label: 'Exportar extrato em Excel', Icon: DocumentIcon },
  { key: 'pdf', label: 'Exportar extrato em PDF', Icon: DocumentTextIcon },
] as const;

export function StatementExportFab() {
  return (
    <FloatingActionMenu
      accessibilityLabel="opções de exportação"
      actions={exportActions.map(({ key, label, Icon }) => ({
        key,
        label,
        Icon,
        onPress: () => Alert.alert('Exportação', `${label} estará disponível em breve.`),
      }))}
    />
  );
}
