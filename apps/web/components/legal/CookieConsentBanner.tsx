'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [preferencesOpen, setPreferencesOpen] = useState(false);
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

  async function savePreferences() {
    const next: CookieCategories = { ...categories, essential: true };
    setCategories(next);
    setVisible(false);
    setPreferencesOpen(false);
    await persistConsent(next, 'SAVE_PREFERENCES');
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-4 z-[60] w-[min(calc(100vw-2rem),28rem)] translate-y-0 rounded-lg border border-white/15 bg-[#190b2d] p-4 text-white shadow-2xl animate-in slide-in-from-bottom-4 duration-500"
        role="region"
        aria-label="Preferencias de cookies"
      >
        <p className="text-sm leading-relaxed text-white/82">
          Usamos cookies essenciais para o funcionamento da Alusa e, com seu consentimento, cookies
          de analise para melhorar sua experiencia.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr]">
          <Button type="button" className="h-10 bg-white text-[#3e1f63] hover:bg-white/90" onClick={acceptAll}>
            Aceitar todos
          </Button>
          <Button type="button" variant="outline" className="h-10 border-white/25 bg-transparent text-white hover:bg-white/10" onClick={rejectNonEssential}>
            Rejeitar nao necessarios
          </Button>
          <Button type="button" variant="ghost" className="h-10 text-white hover:bg-white/10 sm:col-span-2" onClick={() => setPreferencesOpen(true)}>
            Preferencias
          </Button>
        </div>
      </div>

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="max-w-xl" data-sentry-mask>
          <DialogHeader>
            <DialogTitle>Preferencias de cookies</DialogTitle>
            <DialogDescription>
              Cookies nao essenciais ficam desativados ate voce autorizar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <CookieCategoryRow
              title="Cookies essenciais"
              description="Necessarios para sessao, seguranca, autenticacao e funcionamento basico."
              checked
              disabled
              onCheckedChange={() => undefined}
            />
            <CookieCategoryRow
              title="Cookies de analise"
              description="Ajudam a entender uso do site publico sem carregar antes do consentimento."
              checked={categories.analytics}
              onCheckedChange={(analytics) => setCategories((current) => ({ ...current, analytics }))}
            />
            <CookieCategoryRow
              title="Cookies de marketing"
              description="Podem apoiar campanhas e mensuracao comercial quando forem utilizados."
              checked={categories.marketing}
              onCheckedChange={(marketing) => setCategories((current) => ({ ...current, marketing }))}
            />
            <CookieCategoryRow
              title="Cookies de preferencias"
              description="Guardam escolhas de experiencia no site publico."
              checked={categories.preferences}
              onCheckedChange={(preferences) => setCategories((current) => ({ ...current, preferences }))}
            />
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={rejectNonEssential}>
              Rejeitar nao necessarios
            </Button>
            <Button type="button" onClick={savePreferences}>
              Salvar preferencias
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CookieCategoryRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="mt-0.5" />
      <span>
        <span className="block text-sm font-semibold text-slate-950">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-slate-600">{description}</span>
      </span>
    </label>
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
