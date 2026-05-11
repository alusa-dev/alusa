import prisma from '@/lib/prisma';
import RegisterForm from './RegisterForm';
import { redirect } from 'next/navigation';
import AuthPageContainer from '@/components/auth/AuthPageContainer';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';

interface RegisterPageProps {
  searchParams: { token?: string; next?: string };
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const token = searchParams.token;
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
        metadata: true,
      }
    });

    // Token inválido, expirado ou já usado
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      redirect('/auth/login?error=invalid_token');
    }

    // Se for RESPONSAVEL, buscar alunos vinculados
    let alunos: any[] = [];
    if (invite.role === 'RESPONSAVEL' && invite.metadata) {
      const metadata = invite.metadata as { alunosIds?: string[] };
      const alunosIds = metadata.alunosIds || [];

      if (alunosIds.length > 0) {
        const alunosData = await prisma.aluno.findMany({
          where: { id: { in: alunosIds } },
          select: {
            id: true,
            nome: true,
            email: true,
            dataNasc: true,
          },
        });

        alunos = alunosData.map((aluno) => ({
          id: aluno.id,
          nome: aluno.nome,
          email: aluno.email || null,
          idade: aluno.dataNasc ? calcularIdade(aluno.dataNasc) : null,
        }));
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
            alunos: alunos.length > 0 ? alunos : undefined,
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

function calcularIdade(dataNasc: Date): number {
  const hoje = new Date();
  const nascimento = new Date(dataNasc);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }
  return idade;
}
