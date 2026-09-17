import { redirect } from 'next/navigation';

import { FrequenciaPage } from '@/features/aulas/frequencia/FrequenciaPage';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';

export default async function AulasFrequenciaRoutePage() {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  return <FrequenciaPage />;
}
