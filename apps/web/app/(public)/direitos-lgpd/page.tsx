import Link from 'next/link';

import { ButtonLink } from '@/features/site/components/ui/ButtonLink';
import { LegalPage } from '@/features/site/components/legal/LegalPage';
import { legalPages } from '@/features/site/content/legal';

export default function LgpdRightsPage() {
  return (
    <LegalPage
      content={legalPages.direitosLgpd}
      footer={
        <div>
          <ButtonLink href="/direitos-lgpd/solicitar" variant="primary">
            Solicitar atendimento LGPD
          </ButtonLink>
          <p className="mt-4 text-sm text-slate-600">
            Canal público: <Link className="text-[#6b3bb1] underline" href="mailto:privacidade@alusa.app">privacidade@alusa.app</Link>
          </p>
        </div>
      }
    />
  );
}
