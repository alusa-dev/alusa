import { redirect } from 'next/navigation';

export default function UsersRootPage() {
  redirect('/admin/settings/users');
}