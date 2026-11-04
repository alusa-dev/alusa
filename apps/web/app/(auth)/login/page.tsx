import LoginClient from './client';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; token?: string }> }) {
	const params = await searchParams;
	const session = await getServerSession(authOptions);
	const callbackUrl = params.callbackUrl?.startsWith('/auth/register?token=')
		? params.callbackUrl
		: params.token
			? `/auth/register?token=${encodeURIComponent(params.token)}`
			: '/dashboard';
	if (session?.user?.id) redirect(callbackUrl);
	// Invite identities do not receive a tenant session until acceptance. After
	// email verification, send them back to the token-bound form to prove the
	// verified identity with its password and complete the transactional accept.
	if (callbackUrl.startsWith('/auth/register?token=')) redirect(callbackUrl);
	return (
		<AuthPageContainer>
			<LoginClient />
		</AuthPageContainer>
	);
}
