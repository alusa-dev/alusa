import { StudentPaymentDetailsClient } from '@/features/finance/operations/payments/StudentPaymentDetailsClient';

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentPaymentDetailsClient alunoId={studentId} />;
}
