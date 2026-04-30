import type { Metadata } from 'next';
import { PortalFinanceiroTable } from '@/features/portal/financeiro/PortalFinanceiroTable';

export const metadata: Metadata = {
  title: 'Financeiro | Portal do Aluno',
  description: 'Acompanhe suas cobranças, pagamentos e histórico financeiro',
};

export default function PortalFinanceiroPage() {
  return <PortalFinanceiroTable />;
}



