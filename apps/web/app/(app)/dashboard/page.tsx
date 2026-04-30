import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  // Verificação no servidor - ANTES de renderizar qualquer coisa
  const session = await getServerSession(authOptions);
  
  if (session?.user) {
    const user = session.user as { role?: string; contaId?: string };
    
    // Redirecionar ALUNO e RESPONSAVEL para o portal
    if (user.role === 'ALUNO' || user.role === 'RESPONSAVEL') {
      redirect('/portal');
    }

  }

  // Se chegou aqui, é um usuário administrativo - pode ver o dashboard
  return <DashboardClient />;
}
