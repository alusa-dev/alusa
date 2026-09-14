import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '@/providers/AppProviders';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { colors, radius, spacing } from '@/theme/tokens';
import { useSession } from '@/features/session/hooks/use-session';
import { initSentry } from '@/lib/observability/sentry';

function RootNavigator() {
  const { status } = useSession();

  if (status === 'bootstrapping') {
    return <AppBootstrapSkeleton />;
  }

  const isAuthenticated = status === 'authenticated';

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(public)" />
        </Stack.Protected>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function AppBootstrapSkeleton() {
  return (
    <Screen scroll backgroundColor={colors.surface} style={{ gap: spacing.lg, paddingBottom: spacing['2xl'] }}>
      <View style={styles.topBar}><Skeleton width={46} height={46} radius={radius.pill} /><View style={styles.topBarSpacer} /><Skeleton width={26} height={26} radius={radius.pill} /></View>
      <Skeleton width="100%" height={54} radius={radius.pill} />
      <View style={styles.welcome}><View style={styles.welcomeCopy}><Skeleton width="38%" height={14} /><Skeleton width="64%" height={26} /></View><Skeleton width={46} height={46} radius={radius.pill} /></View>
      <View style={styles.quickRow}><Skeleton width="31%" height={44} radius={radius.pill} /><Skeleton width="31%" height={44} radius={radius.pill} /><Skeleton width="31%" height={44} radius={radius.pill} /></View>
      <View style={styles.sectionHeader}><Skeleton width="42%" height={22} /><Skeleton width={36} height={36} radius={radius.pill} /></View>
      <Skeleton width="100%" height={220} radius={radius.lg} />
    </Screen>
  );
}

export default function RootLayout() {
  useEffect(() => {
    initSentry();
  }, []);

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  topBarSpacer: { flex: 1 },
  welcome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  welcomeCopy: { flex: 1, gap: spacing.xs },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
