import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listGlobalAdminErrorLogs } from '@/features/global-admin/logs/queries';
import { GlobalAdminEmptyState, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperErrorsPage({
  searchParams,
}: {
  searchParams: { q?: string; contaId?: string };
}) {
  const data = await listGlobalAdminErrorLogs({
    q: searchParams.q,
    contaId: searchParams.contaId,
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Falhas"
        title="Logs de erros"
        description="Reúna em um só lugar as falhas mais relevantes para atendimento e operação, sem precisar alternar entre várias tabelas."
      />

      <GlobalAdminPanel title="Filtros" description="Busque por conta, texto do erro ou ação administrativa.">
        <form className="grid gap-3 md:grid-cols-[2fr,1fr,auto]" method="GET">
          <Input name="q" defaultValue={searchParams.q} placeholder="Buscar por mensagem, ação ou identificador" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Input name="contaId" defaultValue={searchParams.contaId} placeholder="Conta" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">
            Filtrar
          </Button>
        </form>
      </GlobalAdminPanel>

      <GlobalAdminPanel title="Falhas recentes" description="Os erros mais novos aparecem primeiro.">
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhuma falha encontrada"
              description="Se não houver erro na janela atual, esta lista ficará vazia."
            />
          ) : (
            data.items.map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={item.href ?? '/developer/errors'}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{item.title}</p>
                      <GlobalAdminSeverityBadge severity={item.severity}>
                        {item.kind.toLowerCase()}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{item.contaNome ?? 'Conta não identificada'}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.summary}</p>
                  </div>
                  <p className="text-sm text-slate-500 xl:text-right">
                    {new Date(item.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      </GlobalAdminPanel>
    </div>
  );
}
