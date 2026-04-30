import LoginClient from './client';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';

export default async function LoginPage() {
	const session = await getServerSession(authOptions);
	if (session?.user?.id) redirect('/dashboard');
	return (
		<AuthPageContainer>
			<LoginClient />
		</AuthPageContainer>
	);
}
