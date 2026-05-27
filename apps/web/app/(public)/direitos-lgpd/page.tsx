import Link from 'next/link';

import { ButtonLink } from '@/features/site/components/ui/ButtonLink';
import { LegalPage } from '@/features/site/components/legal/LegalPage';
import { legalPages } from '@/features/site/content/legal';

export default function LgpdRightsPage() {
  return (
    <>
      <LegalPage content={legalPages.direitosLgpd} />
      <section className="border-t border-slate-200 bg-white px-6 pb-16 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <ButtonLink href="/direitos-lgpd/solicitar" variant="primary">
            Solicitar atendimento LGPD
          </ButtonLink>
          <p className="mt-4 text-sm text-slate-600">
            Canal publico: <Link className="text-[#6b3bb1] underline" href="mailto:privacidade@alusa.app">privacidade@alusa.app</Link>
          </p>
        </div>
      </section>
    </>
  );
}
