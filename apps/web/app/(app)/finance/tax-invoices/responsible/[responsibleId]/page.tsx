import { PersonTaxInvoicesClient } from '@/features/finance/operations/tax-invoices/PersonTaxInvoicesClient';

export default async function Page({ params }: { params: Promise<{ responsibleId: string }> }) {
  const { responsibleId } = await params;
  return <PersonTaxInvoicesClient personType="RESPONSAVEL" personId={responsibleId} />;
}
