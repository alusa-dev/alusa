import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '@/providers/AppProviders';
import { LoadingState } from '@/components/feedback/LoadingState';
import { useSession } from '@/features/session/hooks/use-session';
import { initSentry } from '@/lib/observability/sentry';

function RootNavigator() {
  const { status } = useSession();

  if (status === 'bootstrapping') {
    return <LoadingState />;
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
