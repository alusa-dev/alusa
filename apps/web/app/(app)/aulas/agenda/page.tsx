import { redirect } from 'next/navigation';

import { AgendaPage } from '@/features/aulas/agenda/AgendaPage';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

type AgendaRoutePageProps = {
  searchParams: Promise<{
    turmaId?: string | string[];
  }>;
};

function pickSingle(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AulasAgendaRoutePage({ searchParams }: AgendaRoutePageProps) {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  const params = await searchParams;

  return <AgendaPage initialFilters={{ turmaId: pickSingle(params.turmaId) }} />;
}
