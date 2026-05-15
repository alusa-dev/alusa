import { redirect } from 'next/navigation';

import DeveloperLoginClient from './DeveloperLoginClient';
import { getGlobalAdminSession } from '@/features/global-admin/auth/session.server';

export default async function DeveloperLoginPage() {
  const session = await getGlobalAdminSession();
  if (session) redirect('/developer');

  return <DeveloperLoginClient />;
}
