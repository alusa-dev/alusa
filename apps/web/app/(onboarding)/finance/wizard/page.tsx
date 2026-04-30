import type { Metadata } from 'next';

import { FinanceWizard } from '@/components/finance-wizard';

export const metadata: Metadata = {
  title: 'Configurar Conta | Alusa',
  description: 'Configure seu perfil financeiro para começar a receber pagamentos.',
};

export default function FinanceWizardPage() {
  return <FinanceWizard />;
}
