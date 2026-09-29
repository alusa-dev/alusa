import { StudentPaymentDetailsClient } from '@/features/finance/operations/payments/StudentPaymentDetailsClient';

export default async function Page({ params }: { params: Promise<{ responsibleId: string }> }) {
  const { responsibleId } = await params;
  return <StudentPaymentDetailsClient alunoId={responsibleId} personType="RESPONSAVEL" />;
}
