import { Redirect } from 'expo-router';

import { LoadingState } from '@/components/feedback/LoadingState';
import { useSession } from '@/features/session/hooks/use-session';

export default function IndexRoute() {
  const { status } = useSession();

  if (status === 'bootstrapping') {
    return <LoadingState />;
  }

  return <Redirect href={status === 'authenticated' ? '/(app)' : '/(public)/login'} />;
}
