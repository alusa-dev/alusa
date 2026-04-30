import SettingsCardNav from '@/components/settings/SettingsCardNav';

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="settings-card-layout"
      className="flex h-full flex-col space-y-6 overflow-hidden"
    >
      {/* Título fixo */}
      <h1 className="text-2xl font-semibold text-gray-900">Configurações</h1>

      <div className="grid flex-1 grid-cols-12 gap-8 overflow-hidden">
        {/* Sidebar interna */}
        <aside className="col-span-12 md:col-span-2">
          <SettingsCardNav />
        </aside>

        {/* Conteúdo mais largo */}
        <main className="col-span-12 md:col-span-10 overflow-hidden">
          <div className="settings-scroll-container w-full h-full rounded-2xl border border-gray-200 bg-white p-6 overflow-hidden">
            <div className="settings-scroll-area h-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
