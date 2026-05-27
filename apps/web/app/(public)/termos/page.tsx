import { LegalPage } from '@/features/site/components/legal/LegalPage';
import { legalPages } from '@/features/site/content/legal';

export default function TermsPage() {
  return <LegalPage content={legalPages.termos} />;
}
