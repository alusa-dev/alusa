import { redirect } from 'next/navigation';

import { AttendancePage } from '@/features/lessons/attendance/AttendancePage';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/lessons/session';

export const dynamic = 'force-dynamic';

export default async function AulasFrequenciaRoutePage() {
  const user = await getAulasSessionUser();

  if (!canAccessAulas(user)) {
    redirect('/dashboard');
  }

  return <AttendancePage />;
}
