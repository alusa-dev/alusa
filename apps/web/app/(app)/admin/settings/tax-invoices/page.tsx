import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { FiscalInvoiceSettingsFeature } from '@/features/settings/tax-invoices/FiscalInvoiceSettingsFeature';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export default async function NotaFiscalConfigPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string } | undefined;
  if (!user?.role || !allowedRoles.has(user.role.toUpperCase())) {
    redirect('/admin/settings/users');
  }

  return (
    <div className="rounded-lg bg-white p-6">
      <FiscalInvoiceSettingsFeature />
    </div>
  );
}
