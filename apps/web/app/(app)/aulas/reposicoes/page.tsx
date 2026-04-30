import { redirect } from 'next/navigation';

import { ReposicoesPage } from '@/features/aulas/reposicoes/ReposicoesPage';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export default async function AulasReposicoesRoutePage() {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  return <ReposicoesPage />;
}
