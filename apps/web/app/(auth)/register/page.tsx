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
  searchParams: Promise<{ token?: string; next?: string; studentCount?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const token = params.token;
  const requestedStudentCount = Number(params.studentCount);
  const studentCount = Number.isSafeInteger(requestedStudentCount) && requestedStudentCount >= 1 && requestedStudentCount <= 2_147_483_647
    ? requestedStudentCount
    : undefined;

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

    const inviteContext = invite.role === 'RESPONSAVEL' ? 'PORTAL' : 'COLLABORATOR';
    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      const sessionEmail = session.user.email?.trim().toLowerCase();
      const sessionContext = (session.user as { authContext?: string }).authContext;
      const emailMismatch = Boolean(invite.email && invite.email.trim().toLowerCase() !== sessionEmail);
      const contextMismatch = sessionContext !== inviteContext;
      if (emailMismatch || contextMismatch) {
        const targetContext = inviteContext === 'PORTAL' ? 'responsável/aluno' : 'colaborador';
        return (
          <AuthPageContainer>
            <main className="flex min-h-svh items-center justify-center px-4 py-8">
              <div className="w-full max-w-lg rounded-2xl border bg-background p-6 text-center shadow-sm">
                <h1 className="text-xl font-semibold">
                  {contextMismatch ? 'Este convite usa outro tipo de acesso' : 'Convite destinado a outro e-mail'}
                </h1>
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  {contextMismatch
                    ? `Você entrou como ${sessionContext === 'OWNER' ? 'responsável pela escola' : 'outro perfil'}, mas este convite concede acesso como ${targetContext}. Encerre esta sessão e entre com as credenciais desse perfil para manter os acessos separados.`
                    : `Este convite foi enviado para ${invite.email}, mas você entrou como ${session.user.email}. Encerre esta sessão e entre com o e-mail do convite.`}
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
              <AcceptInviteButton token={token} />
            </div>
          </main>
        </AuthPageContainer>
      );
    }

    if (invite.email) {
      const existingUser = await prisma.usuario.findFirst({
        where: { email: { equals: invite.email, mode: 'insensitive' }, status: 'ATIVO' },
        select: { id: true, authCredentials: { where: { context: inviteContext }, select: { id: true }, take: 1 } },
      });
      if (existingUser?.authCredentials.length) {
        redirect(`/auth/login?context=${inviteContext === 'PORTAL' ? 'portal' : 'collaborator'}&callbackUrl=${encodeURIComponent(`/auth/register?token=${token}`)}`);
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

  // Public self-service signup creates the school owner account; the existing
  // wizard starts the 14-day trial only after the school finishes setup.
  if (!enableExternalAsaasOnboarding) {
    const contactHref = studentCount ? `/get-started?studentCount=${studentCount}` : '/get-started';
    return (
      <AuthPageContainer>
        <main className="flex min-h-svh items-center justify-center px-4 py-8">
          <div className="w-full max-w-lg rounded-2xl border bg-background p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold">Vamos conversar sobre a sua escola</h1>
            <p className="mt-2 text-sm text-muted-foreground">Nossa equipe ajuda você a iniciar o cadastro e conectar o financeiro.</p>
            <a className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-[#55298a] px-5 text-sm font-semibold text-white" href={contactHref}>Fale com a Alusa</a>
          </div>
        </main>
      </AuthPageContainer>
    );
  }

  return (
    <AuthPageContainer>
      <RegisterForm enableExternalAsaasOnboarding={enableExternalAsaasOnboarding} onboardingStudentCount={studentCount} />
    </AuthPageContainer>
  );
}
