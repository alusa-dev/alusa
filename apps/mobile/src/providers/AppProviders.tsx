import { type PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryProvider } from './QueryProvider';
import { SessionProvider } from './SessionProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <SessionProvider>{children}</SessionProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
