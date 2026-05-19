import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';
import { prefetchDashboardData } from '@/lib/dashboard/prefetch-dashboard-data';
import { serializeDashboardPrefetch } from '@/lib/dashboard/prefetch-dashboard-data-serializable';

import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    const user = session.user as { role?: string; contaId?: string };

    if (user.role === 'ALUNO' || user.role === 'RESPONSAVEL') {
      redirect('/portal');
    }
  }

  const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;
  const initialData = contaId ? serializeDashboardPrefetch(await prefetchDashboardData(contaId)) : null;

  return <DashboardClient initialData={initialData} />;
}
