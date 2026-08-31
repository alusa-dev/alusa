import { Suspense } from 'react';

import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';

import LoadingClient from './LoadingClient';

export default function AuthLoadingPage() {
  return (
    <AuthPageContainer>
      <Suspense fallback={<AlusaLogoLoader fullScreen />}>
        <LoadingClient />
      </Suspense>
    </AuthPageContainer>
  );
}
