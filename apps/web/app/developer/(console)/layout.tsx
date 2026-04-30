import { GlobalAdminShell } from '@/features/global-admin/shared/GlobalAdminShell';
import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';

export default async function DeveloperConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireGlobalAdminSessionForPage('/developer/dashboard');
  return <GlobalAdminShell username={session.username}>{children}</GlobalAdminShell>;
}
