import { redirect } from 'next/navigation';

import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';

export default async function AulasIndexPage() {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  redirect('/aulas/agenda');
}
