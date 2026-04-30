import { redirect } from 'next/navigation';

import { getGlobalAdminSession } from '@/features/global-admin/auth/session.server';

export default async function DeveloperEntryPage() {
  const session = await getGlobalAdminSession();
  redirect(session ? '/developer/dashboard' : '/developer/login');
}
