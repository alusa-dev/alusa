import AccountSettingsNav from '@/components/settings/AccountSettingsNav';

export default function MinhaContaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="account-card-layout"
      className="flex h-full flex-col space-y-6 overflow-hidden"
    >
      {/* Título fixo */}
      <h1 className="text-2xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
        Minha conta
      </h1>

      <div className="grid flex-1 grid-cols-12 gap-8 overflow-hidden">
        {/* Sidebar interna */}
        <aside className="col-span-12 md:col-span-2">
          <AccountSettingsNav />
        </aside>

        {/* Conteúdo mais largo */}
        <main className="col-span-12 md:col-span-10 overflow-hidden">
      <div className="w-full h-full overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
            <div className="h-full overflow-y-auto">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
