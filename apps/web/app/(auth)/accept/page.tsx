import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import AuthCard from '@/components/auth/AuthCard';

type Props = { searchParams?: { [key: string]: string | string[] | undefined } };

export default async function AcceptInvitePage(props: Props) {
  const tokenParam = props.searchParams?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  if (!token) {
    return (
      <AuthPageContainer>
        <AuthCard className="w-[480px] px-12 py-10">
          <p className="text-sm text-red-600" role="alert" data-testid="accept-error">Token não informado.</p>
        </AuthCard>
      </AuthPageContainer>
    );
  }

  const invite = await prisma.invite.findFirst({
    where: { token, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { token: true },
  });

  if (!invite) {
    return (
      <AuthPageContainer>
        <AuthCard className="w-[480px] px-12 py-10">
          <p className="text-sm text-red-600" role="alert" data-testid="accept-error">Convite inválido ou expirado.</p>
        </AuthCard>
      </AuthPageContainer>
    );
  }

  redirect(`/auth/register?token=${encodeURIComponent(token)}`);
}
