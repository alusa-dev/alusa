"use client";
import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { useEffect } from 'react';
import { toast, Toaster } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { KycEnforcementProvider } from '@/features/kyc/KycEnforcementProvider';

export function AppProviders({ children }: { children: ReactNode }) {
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
    <SessionProvider>
      <ThemeProvider>
        <KycEnforcementProvider>
          {children}
          <Toaster />
        </KycEnforcementProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
