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
	return (
		<AuthPageContainer>
			<LoginClient />
		</AuthPageContainer>
	);
}
