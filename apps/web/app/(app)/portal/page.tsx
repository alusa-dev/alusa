import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import { PortalDashboardFeature } from '@/features/portal/dashboard/PortalDashboardFeature';

export default async function PortalPage() {
  // Verificação no servidor - ANTES de renderizar qualquer coisa
  const session = await getServerSession(authOptions);
  
  if (session?.user) {
    const user = session.user as { role?: string };
    
    // Redirecionar usuários administrativos para o dashboard
    if (user.role !== 'ALUNO' && user.role !== 'RESPONSAVEL') {
      redirect('/dashboard');
    }
  }

  // Se chegou aqui, é ALUNO ou RESPONSAVEL - pode ver o portal
  return <PortalDashboardFeature />;
}


