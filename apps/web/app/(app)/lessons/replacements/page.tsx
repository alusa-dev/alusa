import { redirect } from 'next/navigation';

import { MakeupsPage } from '@/features/lessons/makeups/MakeupsPage';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/lessons/session';

export const dynamic = 'force-dynamic';

export default async function AulasReposicoesRoutePage() {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  return <MakeupsPage />;
}
