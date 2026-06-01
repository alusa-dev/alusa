'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';

import { Button } from '@/components/ui/button';
import {
  COOKIE_POLICY_VERSION,
} from '@/lib/privacy/legal-versions';
import type { CookieCategories } from '@/lib/privacy/cookie-consent';
import { defaultCookieCategories } from '@/lib/privacy/cookie-consent';

const STORAGE_KEY = 'alusa.cookie-consent.v1';
const ANON_KEY = 'alusa.anonymous-id';
const CONSENT_EVENT = 'alusa-cookie-consent-updated';

type StoredConsent = {
  policyVersion: string;
  categories: CookieCategories;
  decidedAt: string;
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
  '/suboperadores',
  '/dpa',
  '/direitos-lgpd',
  '/preferencias-de-cookies',
];

const authenticatedPrefixes = [
  '/dashboard',
  '/admin',
  '/alunos',
  '/responsaveis',
  '/matriculas',
  '/cobrancas',
  '/finance',
  '/financeiro',
  '/conta',
  '/portal',
  '/developer',
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
    const existing = window.localStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(ANON_KEY, next);
    return next;
  } catch {
    return `anon_${Date.now().toString(36)}`;
  }
}

async function persistConsent(categories: CookieCategories, decision: 'ACCEPT_ALL' | 'REJECT_NON_ESSENTIAL' | 'SAVE_PREFERENCES') {
  const stored: StoredConsent = {
    policyVersion: COOKIE_POLICY_VERSION,
    categories,
    decidedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: stored }));

  await fetch('/api/privacy/cookie-consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anonymousId: getAnonymousId(),
      categories,
      decision,
      policyVersion: COOKIE_POLICY_VERSION,
    }),
  }).catch(() => undefined);
}

export function CookieConsentBanner() {
  const pathname = usePathname() ?? '/';
  const [visible, setVisible] = useState(false);
  const [categories, setCategories] = useState<CookieCategories>(defaultCookieCategories);

  const shouldRender = useMemo(() => isCookieBannerPath(pathname), [pathname]);

  useEffect(() => {
    if (!shouldRender) {
      setVisible(false);
      return;
    }

    const stored = readStoredConsent();
    if (stored) {
      setCategories(stored.categories);
      setVisible(false);
    } else {
      setVisible(true);
    }

    const handleConsentUpdated = () => {
      setVisible(false);
    };

    window.addEventListener(CONSENT_EVENT, handleConsentUpdated);
    return () => {
      window.removeEventListener(CONSENT_EVENT, handleConsentUpdated);
    };
  }, [shouldRender]);

  if (!shouldRender || !visible) return null;

  async function acceptAll() {
    const next: CookieCategories = { essential: true, analytics: true, marketing: true, preferences: true };
    setCategories(next);
    setVisible(false);
    await persistConsent(next, 'ACCEPT_ALL');
  }

  async function rejectNonEssential() {
    const next: CookieCategories = { essential: true, analytics: false, marketing: false, preferences: false };
    setCategories(next);
    setVisible(false);
    await persistConsent(next, 'REJECT_NON_ESSENTIAL');
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-4 z-[60] w-[min(calc(100vw-2rem),28rem)] translate-y-0 rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl animate-in slide-in-from-bottom-4 duration-500"
        role="region"
        aria-label="Preferencias de cookies"
      >
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
          >
            Aceitar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-slate-200 bg-white text-alusa-purple hover:bg-alusa-purple-tint hover:text-alusa-purple-hover font-semibold transition-colors"
            onClick={rejectNonEssential}
          >
            Rejeitar todos
          </Button>
        </div>
      </div>
    </>
  );
}

export function ConsentAwareAnalytics() {
  const pathname = usePathname() ?? '/';
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    function syncConsent() {
      if (!isCookieBannerPath(pathname)) {
        setEnabled(false);
        return;
      }
      const stored = readStoredConsent();
      setEnabled(stored?.categories.analytics === true);
    }

    syncConsent();
    window.addEventListener(CONSENT_EVENT, syncConsent);
    return () => window.removeEventListener(CONSENT_EVENT, syncConsent);
  }, [pathname]);

  return enabled ? <Analytics /> : null;
}
