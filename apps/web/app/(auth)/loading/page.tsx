import AuthPageContainer from '@/components/auth/AuthPageContainer';

import LoadingClient from './LoadingClient';

export default function AuthLoadingPage() {
  return (
    <AuthPageContainer>
      <LoadingClient />
    </AuthPageContainer>
  );
}