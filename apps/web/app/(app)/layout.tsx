'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';

import { useSession } from 'next-auth/react';
import CardHeader from '@/components/layout/CardHeader';
import { MobileAppHeader } from '@/components/layout/MobileAppHeader';
import { Sidebar } from '@/components/layout/Sidebar';
import { useUserStore } from '@/lib/stores/user-store';

const ExternalAsaasOnboardingPersistentModal = dynamic(
  () =>
    import('@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal').then((m) => ({
      default: m.ExternalAsaasOnboardingPersistentModal,
    })),
  { ssr: false },
);

const GlobalQuickCreatePortals = dynamic(
  () =>
    import('@/app/(app)/global-quick-create-portals').then((m) => ({
      default: m.GlobalQuickCreatePortals,
    })),
  { ssr: false },
);

/** Espaçamentos já validados por você */
const CONTENT_GAP_PX = 12;
const OUTER_PADDING_TOP_PX = 20;
const OUTER_PADDING_RIGHT_PX = 24; // igual ao padding inferior
const OUTER_PADDING_BOTTOM_PX = 24;
const OUTER_PADDING_LEFT_PX = 12; // espaço para sombra do card não ser cortada
const CARD_PADDING_PX = 32;
const CARD_RADIUS_PX = 40;
const CARD_SHADOW =
  'rgba(14, 63, 126, 0.06) 0px 0px 0px 1px, rgba(42, 51, 70, 0.03) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 2px 2px -1px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.03) 0px 5px 5px -2.5px, rgba(42, 51, 70, 0.03) 0px 10px 10px -5px, rgba(42, 51, 70, 0.03) 0px 24px 24px -8px';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  // Hidrata a store central de usuário sempre que a sessão muda (garante persistência do avatar no header)
  // Obter função diretamente via getState evita problemas de tipagem durante CI/sem node_modules
  const setUser = useUserStore.getState().setUser;
  useEffect(() => {
    setUser(session?.user ?? null);
  }, [session, setUser]);

  // Health ping em dev
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      const w = window as unknown as { __alusaHealthCalled?: boolean };
      if (!w.__alusaHealthCalled) {
        w.__alusaHealthCalled = true;
        fetch('/api/health', { cache: 'no-store' }).catch(() => {});
      }
    }
  }, []);

  // largura inicial da sidebar
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (!root.style.getPropertyValue('--sidebar-w')) {
        root.style.setProperty('--sidebar-w', '262px');
      }

      root.style.setProperty('--app-toast-right-offset', `${OUTER_PADDING_RIGHT_PX + CARD_PADDING_PX}px`);
    }
  }, []);

  // Regra solicitada: Sidebar SEMPRE exibida nas páginas dentro de (app)
  // (Mantemos session effect/health ping para consistência.)

  return (
    <div className="relative flex min-h-[100svh] w-full flex-col overflow-x-hidden bg-white lg:block lg:h-screen lg:min-h-0 lg:overflow-hidden lg:bg-[var(--app-bg)]">
      <Sidebar />
      <MobileAppHeader />

      <main
        className="with-sidebar flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden transition-[padding-left] duration-300 ease-in-out lg:h-full lg:overflow-hidden"
        style={{ ['--sidebar-gap' as string]: `${CONTENT_GAP_PX}px` } as Record<string, string>}
      >
        <div
          style={{
            paddingTop: OUTER_PADDING_TOP_PX,
            paddingRight: OUTER_PADDING_RIGHT_PX,
            paddingBottom: OUTER_PADDING_BOTTOM_PX,
            paddingLeft: OUTER_PADDING_LEFT_PX,
          }}
          className="app-shell-outer flex min-h-0 flex-1 flex-col overflow-visible lg:h-full"
        >
          <div
            data-app-shell-card
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden transition-[width] duration-300 ease-in-out lg:h-full"
            style={{
              height: `calc(100vh - ${OUTER_PADDING_TOP_PX + OUTER_PADDING_BOTTOM_PX}px)`,
              background: '#FFFFFF',
              borderRadius: CARD_RADIUS_PX,
              padding: CARD_PADDING_PX,
              boxShadow: CARD_SHADOW,
              ['--app-shell-card-shadow' as string]: CARD_SHADOW,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div className="hidden shrink-0 lg:block">
              <CardHeader />
            </div>
            {/* Wrapper para o conteúdo das páginas. Removido CustomScrollArea para evitar scroll duplo no Editor.
                Páginas que precisam de scroll devem gerenciar seu próprio overflow (ex: DataTables, Dashboards).
             */}
            <div
              className="relative mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col app-content-scroll lg:mt-6"
              style={{ paddingRight: OUTER_PADDING_RIGHT_PX }}
            >
              {children}
            </div>
            <ExternalAsaasOnboardingPersistentModal />
            <GlobalQuickCreatePortals />
          </div>
        </div>
      </main>
    </div>
  );
}
