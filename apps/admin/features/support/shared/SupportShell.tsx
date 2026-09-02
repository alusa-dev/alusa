import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { AdminSession } from '@/lib/admin-session';

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Visão geral', icon: 'Search' },
  { href: '/contas', label: 'Contas', icon: 'BuildingLibrary' },
  { href: '/financeiro', label: 'Financeiro', icon: 'CreditCard' },
  { href: '/webhooks', label: 'Webhooks', icon: 'Refresh' },
  { href: '/casos', label: 'Casos', icon: 'DocumentText' },
  { href: '/auditoria', label: 'Auditoria', icon: 'Clock' },
  { href: '/configuracoes', label: 'Configurações', icon: 'Settings' },
];

export function SupportShell({ children, session }: { children: ReactNode; session: AdminSession }) {
  return <div className="min-h-screen bg-slate-50 text-slate-950"><aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white lg:flex lg:flex-col"><div className="border-b border-slate-200 px-6 py-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white"><Icon name="CheckCircle" size={20} /></div><div><p className="text-sm font-semibold">Alusa</p><p className="text-xs text-slate-500">Central administrativa</p></div></div></div><nav className="flex-1 space-y-1 px-3 py-4">{navigation.map((item) => <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"><Icon name={item.icon} />{item.label}</Link>)}</nav><div className="border-t border-slate-200 px-6 py-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Identidade atual</p><p className="mt-2 text-sm font-medium">{session.username}</p><p className="text-xs text-slate-500">{session.adminRole}</p></div></aside><div className="lg:pl-72"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8"><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Backoffice isolado</p><h1 className="text-lg font-semibold text-slate-950">Operações e suporte</h1></div><div className="flex items-center gap-4"><div className="hidden text-right sm:block"><p className="text-sm font-medium">{session.username}</p><p className="text-xs text-slate-500">{session.adminRole}</p></div><form action="/api/auth/logout" method="post"><button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700" type="submit">Sair</button></form></div></div><nav className="flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">{navigation.map((item) => <Link key={item.href} href={item.href} className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">{item.label}</Link>)}</nav></header><main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main></div></div>;
}
