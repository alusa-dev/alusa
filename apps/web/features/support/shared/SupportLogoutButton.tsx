'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/button';

export function SupportLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    await fetch('/api/global-admin/auth/logout', { method: 'POST' }).catch(() => null);
    router.replace('/developer/login');
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={logout} disabled={submitting}>
      <Icon name="Logout" />
      {submitting ? 'Saindo...' : 'Sair'}
    </Button>
  );
}
