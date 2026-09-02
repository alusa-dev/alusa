import { requireAdminSession } from '@/lib/session';

export default async function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdminSession('/');
  void session;
  return children;
}
