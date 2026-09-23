import prisma from '@/lib/prisma';
import RegisterForm from './RegisterForm';
import { redirect } from 'next/navigation';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import AcceptInviteButton from './AcceptInviteButton';
import SignOutForInviteButton from './SignOutForInviteButton';

interface RegisterPageProps {
  searchParams: Promise<{ token?: string; next?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const token = params.token;
  const enableExternalAsaasOnboarding = isExternalAsaasOnboardingRolloutEnabled();

  // Se há token, validar convite
  if (token) {
    const invite = await prisma.invite.findUnique({
      where: { token },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
      }
    });

    // Token inválido, expirado ou já usado
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      redirect('/auth/login?error=invalid_token');
    }

    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      const sessionEmail = session.user.email?.trim().toLowerCase();
      if (invite.email && invite.email.trim().toLowerCase() !== sessionEmail) {
        return (
          <AuthPageContainer>
            <main className="flex min-h-svh items-center justify-center px-4 py-8">
              <div className="w-full max-w-lg rounded-2xl border bg-background p-6 text-center shadow-sm">
                <h1 className="text-xl font-semibold">Convite válido para outro e-mail</h1>
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  Este convite foi enviado para <strong>{invite.email}</strong>, mas você está conectado como <strong>{session.user.email}</strong>. Para aceitá-lo na conta correta, saia desta sessão e entre com o e-mail do convite.
                </p>
                <SignOutForInviteButton token={token} />
              </div>
            </main>
          </AuthPageContainer>
        );
      }
      return (
        <AuthPageContainer>
          <main className="flex min-h-svh items-center justify-center px-4 py-8">
            <div data-testid="invite-acceptance-card" className="w-full max-w-lg rounded-2xl border p-6 text-center">
              <h1 className="text-xl font-semibold">Aceitar convite da escola</h1>
              <p className="mt-2 text-sm text-muted-foreground">Você está autenticado como {session.user.email}. Confirme para adicionar o acesso sem criar outra conta ou alterar sua senha.</p>
              <AcceptInviteButton token={token} requireGuardianData={invite.role === 'RESPONSAVEL'} />
            </div>
          </main>
        </AuthPageContainer>
      );
    }

    if (invite.email) {
      const existingUser = await prisma.usuario.findFirst({
        where: { email: { equals: invite.email, mode: 'insensitive' } },
        select: { id: true, status: true },
      });
      if (existingUser && String(existingUser.status).toUpperCase() === 'ATIVO') {
        redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${token}`)}`);
      }
    }

    return (
      <AuthPageContainer>
        <RegisterForm
          enableExternalAsaasOnboarding={enableExternalAsaasOnboarding}
          inviteData={{
            email: invite.email || undefined,
            role: invite.role,
            token,
          }}
        />
      </AuthPageContainer>
    );
  }

  // Sem token: fluxo direto sempre cria ADMIN (first-register)
  return (
    <AuthPageContainer>
      <RegisterForm enableExternalAsaasOnboarding={enableExternalAsaasOnboarding} />
    </AuthPageContainer>
  );
}
