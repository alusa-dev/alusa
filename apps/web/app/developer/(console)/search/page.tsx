import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchGlobalAdmin } from '@/features/global-admin/search/queries';
import { GlobalAdminEmptyState, GlobalAdminPageIntro, GlobalAdminPanel } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperSearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = searchParams.q?.trim() ?? '';
  const data = await searchGlobalAdmin(query);

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Localização rápida"
        title="Busca global"
        description="Procure por conta, usuário, cobrança, matrícula, paymentId ou eventId. A busca já agrupa os resultados por tipo para encurtar o caminho do suporte."
      />

      <GlobalAdminPanel title="Pesquisar" description="Use qualquer identificador que você tenha em mãos.">
          <form className="flex gap-3" method="GET">
            <Input
              name="q"
              defaultValue={query}
              placeholder="conta, e-mail, paymentId, matrícula, eventId..."
              className="h-10 rounded-lg border-slate-200 bg-white shadow-sm"
            />
            <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">
              Buscar
            </Button>
          </form>
      </GlobalAdminPanel>

      {query ? (
        data.groups.length > 0 ? (
          data.groups.map((group) => (
            <GlobalAdminPanel key={group.key} title={group.label} description={`${group.total} resultado(s)`}>
              <div className="space-y-3">
                {group.items.map((item) => (
                  <Link
                    key={`${group.key}-${item.id}`}
                    href={item.href}
                    className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <p className="font-medium text-slate-950">{item.title}</p>
                    <p className="text-sm text-slate-600">{item.subtitle}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.tenantName ? `${item.tenantName} • ` : ''}
                      {item.id}
                    </p>
                  </Link>
                ))}
              </div>
            </GlobalAdminPanel>
          ))
        ) : (
          <GlobalAdminEmptyState
            title="Nenhum resultado encontrado"
            description="Tente outro termo ou use um identificador mais próximo da cobrança, conta ou usuário que você procura."
          />
        )
      ) : null}
    </div>
  );
}
