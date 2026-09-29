import { PersonTaxInvoicesClient } from '@/features/finance/operations/tax-invoices/PersonTaxInvoicesClient';

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <PersonTaxInvoicesClient personType="ALUNO" personId={studentId} />;
}
