import { LegalPage } from '@/features/site/components/legal/LegalPage';
import { legalPages } from '@/features/site/content/legal';
import Link from 'next/link';

export default function CookiesPage() {
  return (
    <LegalPage
      content={legalPages.cookies}
      footer={
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-slate-700">
          <h3 className="text-lg font-semibold text-[#2a1744] mb-2">Gerenciamento de Preferências</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            Você pode revisar, gerenciar e alterar o consentimento de cookies não essenciais a qualquer momento acessando nossa página de{' '}
            <Link href="/preferencias-de-cookies" className="underline font-semibold text-alusa-purple hover:text-alusa-purple-hover">
              Configurações de cookies
            </Link>
            .
          </p>
        </div>
      }
    />
  );
}
