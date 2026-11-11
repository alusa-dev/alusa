'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  COOKIE_POLICY_VERSION,
} from '@/lib/privacy/legal-versions';
import type { CookieCategories } from '@/lib/privacy/cookie-consent';
import { COOKIE_CONSENT_ANONYMOUS_ID_KEY } from '@/lib/privacy/cookie-consent-anonymous-id';
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_UPDATED_EVENT, persistCookieConsentForClient } from '@/lib/privacy/persist-cookie-consent-client';

const STORAGE_KEY = COOKIE_CONSENT_STORAGE_KEY;
const CONSENT_EVENT = COOKIE_CONSENT_UPDATED_EVENT;

type StoredConsent = {
  policyVersion: string;
  categories: CookieCategories;
  decidedAt: string;
  syncStatus?: 'PENDING' | 'SYNCED' | 'FAILED';
};

const publicPrefixes = [
  '/',
  '/auth/login',
  '/auth/register',
  '/login',
  '/cadastro',
  '/privacidade',
  '/termos',
  '/cookies',
  '/seguranca',
  '/security',
  '/suboperadores',
  '/dpa',
  '/direitos-lgpd',
  '/preferencias-de-cookies',
  '/m',
];

const authenticatedPrefixes = [
  '/dashboard',
  '/admin',
  '/students',
  '/responsibles',
  '/enrollments',
  '/charges',
  '/finance',
  '/finance',
  '/account',
  '/portal',
];

function isCookieBannerPath(pathname: string): boolean {
  if (authenticatedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }

  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function readStoredConsent(): StoredConsent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (parsed.policyVersion !== COOKIE_POLICY_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getAnonymousId(): string {
  try {
    const existing = window.localStorage.getItem(COOKIE_CONSENT_ANONYMOUS_ID_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(COOKIE_CONSENT_ANONYMOUS_ID_KEY, next);
    return next;
  } catch {
    return `anon_${Date.now().toString(36)}`;
  }
}

async function persistConsent(categories: CookieCategories, decision: 'ACCEPT_ALL' | 'REJECT_NON_ESSENTIAL' | 'SAVE_PREFERENCES') {
  return persistCookieConsentForClient({ categories, decision, anonymousId: getAnonymousId() });
}

export function CookieConsentBanner() {
  const pathname = usePathname() ?? '/';
  const [visible, setVisible] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [retryChoice, setRetryChoice] = useState<{ categories: CookieCategories; decision: 'ACCEPT_ALL' | 'REJECT_NON_ESSENTIAL' | 'SAVE_PREFERENCES' } | null>(null);

  const shouldRender = useMemo(() => isCookieBannerPath(pathname), [pathname]);

  useEffect(() => {
    if (!shouldRender) {
      setVisible(false);
      return;
    }

    const stored = readStoredConsent();
    if (stored?.syncStatus === 'SYNCED') {
      setVisible(false);
    } else {
      setVisible(true);
      setSyncError(Boolean(stored));
      if (stored) setRetryChoice({ categories: stored.categories, decision: 'SAVE_PREFERENCES' });
    }

    const handleConsentUpdated = (event: Event) => {
      const detail = (event as CustomEvent<StoredConsent>).detail;
      setVisible(detail?.syncStatus !== 'SYNCED');
      setSyncing(detail?.syncStatus === 'PENDING');
      setSyncError(detail?.syncStatus === 'FAILED');
    };

    window.addEventListener(CONSENT_EVENT, handleConsentUpdated);
    return () => {
      window.removeEventListener(CONSENT_EVENT, handleConsentUpdated);
    };
  }, [shouldRender]);

  if (!shouldRender || !visible) return null;

  async function acceptAll() {
    const next: CookieCategories = { essential: true, analytics: true, marketing: true, preferences: true };
    setRetryChoice({ categories: next, decision: 'ACCEPT_ALL' });
    await saveChoice(next, 'ACCEPT_ALL');
  }

  async function rejectNonEssential() {
    const next: CookieCategories = { essential: true, analytics: false, marketing: false, preferences: false };
    setRetryChoice({ categories: next, decision: 'REJECT_NON_ESSENTIAL' });
    await saveChoice(next, 'REJECT_NON_ESSENTIAL');
  }

  async function saveChoice(categories: CookieCategories, decision: 'ACCEPT_ALL' | 'REJECT_NON_ESSENTIAL' | 'SAVE_PREFERENCES') {
    setSyncing(true);
    setSyncError(false);
    const succeeded = await persistConsent(categories, decision);
    setSyncing(false);
    setSyncError(!succeeded);
    setVisible(!succeeded);
  }

  async function retryPersistence() {
    if (retryChoice) await saveChoice(retryChoice.categories, retryChoice.decision);
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-4 z-[60] w-[min(calc(100vw-2rem),28rem)] translate-y-0 rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl animate-in slide-in-from-bottom-4 duration-500"
        role="region"
        aria-label="Preferencias de cookies"
      >
        {syncError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            Não foi possível confirmar suas preferências no servidor. Sua escolha continua aplicada neste navegador, mas o consentimento não será usado no checkout até a confirmação.
            <Button type="button" variant="link" className="mt-1 h-auto p-0 text-red-900 underline" onClick={retryPersistence}>
              Tentar salvar novamente
            </Button>
          </div>
        )}
        <p className="text-sm leading-relaxed text-slate-600">
          Usamos cookies para aprimorar sua experiência e para fins de publicidade. Leia nossa{' '}
          <a href="/cookies" className="underline font-semibold text-slate-800 hover:text-slate-955">
            Política de Cookies
          </a>{' '}
          ou{' '}
          <Link
            href="/preferencias-de-cookies"
            className="underline font-semibold text-slate-800 hover:text-slate-955 cursor-pointer align-baseline"
          >
            gerencie os cookies
          </Link>
          .
        </p>
        <div className="mt-4 grid gap-3 grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 border-slate-200 bg-white text-alusa-purple hover:bg-alusa-purple-tint hover:text-alusa-purple-hover font-semibold transition-colors"
            onClick={acceptAll}
            disabled={syncing}
          >
            {syncing ? 'Salvando…' : 'Aceitar todos'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-slate-200 bg-white text-alusa-purple hover:bg-alusa-purple-tint hover:text-alusa-purple-hover font-semibold transition-colors"
            onClick={rejectNonEssential}
            disabled={syncing}
          >
            {syncing ? 'Salvando…' : 'Rejeitar todos'}
          </Button>
        </div>
      </div>
    </>
  );
}
