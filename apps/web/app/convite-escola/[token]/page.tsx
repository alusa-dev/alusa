import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { InvitationAcceptance } from './InvitationAcceptance';

export default async function SchoolInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AuthPageContainer><main className="mx-auto flex min-h-svh max-w-2xl items-center px-4 py-10"><InvitationAcceptance token={token} /></main></AuthPageContainer>;
}
