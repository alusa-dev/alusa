"use client";
import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { useEffect, useState } from 'react';
import { toast, Toaster } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { KycEnforcementProvider } from '@/features/kyc/KycEnforcementProvider';
import { QueryProvider } from '@/components/providers/query-provider';
import { PlatformBillingProvider } from '@/features/platform-billing/PlatformBillingContext';
import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';

function LogoutLoadingOverlay() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const onLogoutStart = () => setIsLoggingOut(true);
    const onLogoutEnd = () => setIsLoggingOut(false);

    window.addEventListener('alusa:logout:start', onLogoutStart);
    window.addEventListener('alusa:logout:end', onLogoutEnd);
    return () => {
      window.removeEventListener('alusa:logout:start', onLogoutStart);
      window.removeEventListener('alusa:logout:end', onLogoutEnd);
    };
  }, []);

  return isLoggingOut ? <AlusaLogoLoader fullScreen /> : null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('theme-ready');
    document.body.classList.add('theme-ready');
  }, []);

  // Listeners globais para eventos de toast disparados por componentes isolados (ex.: Wizard)
  useEffect(() => {
    function onSuccess(e: Event) {
      try {
        const detail = (e as CustomEvent<{ message?: string; description?: string }>).detail || {};
        const msg = detail.message || 'Ação concluída com sucesso';
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title={msg}
            onClose={() => { toast.dismiss(t); }}
          />
        ));
      } catch { /* noop */ }
    }
    function onError(e: Event) {
      try {
        const detail = (e as CustomEvent<{ message?: string; description?: string }>).detail || {};
        const msg = detail.message || 'Falha ao executar ação';
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title={msg}
            onClose={() => { toast.dismiss(t); }}
          />
        ));
      } catch { /* noop */ }
    }
    window.addEventListener('toast:success', onSuccess as EventListener);
    window.addEventListener('toast:error', onError as EventListener);
    return () => {
      window.removeEventListener('toast:success', onSuccess as EventListener);
      window.removeEventListener('toast:error', onError as EventListener);
    };
  }, []);
  return (
    <SessionProvider
      basePath="/api/auth"
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      <QueryProvider>
        <PlatformBillingProvider>
          <ThemeProvider>
            <KycEnforcementProvider>
              {children}
              <LogoutLoadingOverlay />
              <Toaster />
            </KycEnforcementProvider>
          </ThemeProvider>
        </PlatformBillingProvider>
      </QueryProvider>
    </SessionProvider>
  );
}
