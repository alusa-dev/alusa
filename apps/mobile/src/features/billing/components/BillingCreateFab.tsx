import { router } from 'expo-router';
import { BanknotesIcon } from 'react-native-heroicons/outline';

import { FloatingActionMenu } from '@/components/overlays/FloatingActionMenu';

export function BillingCreateFab() {
  return (
    <FloatingActionMenu
      accessibilityLabel="ações de cobrança"
      actions={[{
        key: 'create-charge',
        label: 'Criar cobrança',
        Icon: BanknotesIcon,
        onPress: () => router.push('/(app)/billing/create'),
      }]}
    />
  );
}
