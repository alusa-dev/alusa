import { Tabs } from 'expo-router';
import { Platform } from 'react-native';

import { colors, radius } from '@/theme/tokens';

export default function AuthenticatedLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.72)',
        tabBarStyle: {
          backgroundColor: colors.brand,
          borderTopWidth: 0,
          marginHorizontal: 24,
          marginBottom: Platform.OS === 'ios' ? 18 : 12,
          height: 66,
          borderRadius: radius.pill,
          position: 'absolute',
        },
        tabBarLabelStyle: {
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarAccessibilityLabel: 'Ir para início',
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Conta',
          tabBarAccessibilityLabel: 'Ir para conta',
        }}
      />
    </Tabs>
  );
}
