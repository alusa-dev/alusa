import type { AdminRole } from '@alusa/admin-auth';
import { createAdminUser, listAdminUsers, updateAdminUser } from '@/features/admin-users';

export { createAdminUser, listAdminUsers, updateAdminUser } from '@/features/admin-users';

export async function listSupportUsers() {
  return listAdminUsers();
}

export async function createSupportUser(input: { username: string; email?: string | null; password: string; role: AdminRole }) {
  return createAdminUser(input);
}

export async function updateSupportUser(input: { id: string; role?: AdminRole; status?: 'ACTIVE' | 'DISABLED' }) {
  return updateAdminUser(input);
}
