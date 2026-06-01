'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { pushToast } from '@/components/ui/toast';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { LegalSidebarNav } from '@/features/site/components/legal/LegalSidebarNav';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { COOKIE_POLICY_VERSION } from '@/lib/privacy/legal-versions';
import type { CookieCategories } from '@/lib/privacy/cookie-consent';
import { defaultCookieCategories } from '@/lib/privacy/cookie-consent';

const STORAGE_KEY = 'alusa.cookie-consent.v1';
const ANON_KEY = 'alusa.anonymous-id';
const CONSENT_EVENT = 'alusa-cookie-consent-updated';

type CookieDetail = {
  name: string;
  domain: string;
  type: 'Próprio' | 'Terceiro';
  duration: string;
  description: string;
};

type CategoryInfo = {
  key: keyof CookieCategories;
  title: string;
  description: string;
  isEssential?: boolean;
  cookies: CookieDetail[];
};

const CATEGORIES_METADATA: CategoryInfo[] = [
  {
    key: 'essential',
    title: 'Essenciais',
    description: 'Cookies estritamente necessários para a funcionalidade básica do site ou aplicativo. Esses cookies garantem segurança, autenticação e a integridade de sua sessão.',
    isEssential: true,
    cookies: [
      {
        name: 'alusa.session',
        domain: '.alusa.com.br',
        type: 'Próprio',
        duration: 'Sessão',
        description: 'Mantém a sessão do usuário autenticado de forma segura.'
      },
      {
        name: 'alusa.csrf',
        domain: '.alusa.com.br',
        type: 'Próprio',
        duration: 'Sessão',
        description: 'Previne ataques maliciosos de falsificação de solicitação entre sites.'
      },
      {
        name: 'alusa.cookie-consent.v1',
        domain: '.alusa.com.br',
        type: 'Próprio',
        duration: '1 ano',
        description: 'Armazena as preferências de consentimento de cookies selecionadas pelo visitante.'
      }
    ]
  },
  {
    key: 'preferences',
    title: 'Preferências',
    description: 'Permitem lembrar suas escolhas de personalização, como idioma de preferência ou a aparência do tema (claro ou escuro) para visitas futuras.',
    cookies: [
      {
        name: 'alusa.theme',
        domain: '.alusa.com.br',
        type: 'Próprio',
        duration: 'Persistente',
        description: 'Armazena a escolha de tema (claro ou escuro) definida pelo usuário.'
      },
      {
        name: 'alusa.lang',
        domain: '.alusa.com.br',
        type: 'Próprio',
        duration: 'Persistente',
        description: 'Lembra o idioma de navegação escolhido pelo usuário.'
      }
    ]
  },
  {
    key: 'analytics',
    title: 'Análise de Uso',
    description: 'Ajudam a entender como os visitantes navegam pelas páginas públicas, permitindo medir e melhorar o desempenho do site através de dados agregados.',
    cookies: [
      {
        name: '_ga',
        domain: '.alusa.com.br',
        type: 'Terceiro',
        duration: '2 anos',
        description: 'Utilizado para distinguir usuários únicos de forma anônima e medir visitas.'
      },
      {
        name: '_gid',
        domain: '.alusa.com.br',
        type: 'Terceiro',
        duration: '24 horas',
        description: 'Armazena e atualiza um valor único para cada página visitada para estatísticas.'
      }
    ]
  },
  {
    key: 'marketing',
    title: 'Publicidade',
    description: 'Os cookies de publicidade nos permitem oferecer anúncios direcionados da Alusa para você em outros sites que você visita, bem como avaliar seu engajamento com esses anúncios.',
    cookies: [
      {
        name: '_fbp',
        domain: '.alusa.com.br',
        type: 'Terceiro',
        duration: '3 meses',
        description: 'Utilizado pelo Facebook para fornecer anúncios personalizados e mensuração.'
      },
      {
        name: '_gcl_au',
        domain: '.alusa.com.br',
        type: 'Terceiro',
        duration: '3 meses',
        description: 'Armazena dados de cliques em anúncios para melhorar campanhas de marketing.'
      }
    ]
  }
];

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

export default function CookiePreferencesPage() {
  const [categories, setCategories] = useState<CookieCategories>(defaultCookieCategories);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.categories && parsed.policyVersion === COOKIE_POLICY_VERSION) {
          setCategories(parsed.categories);
        }
      }
    } catch {
      // Ignorar erros na leitura
    }
  }, []);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggle = (key: keyof CookieCategories, checked: boolean) => {
    if (key === 'essential') return;
    setCategories((prev) => ({ ...prev, [key]: checked }));
  };

  const savePreferences = async (customCategories: CookieCategories, decision: 'ACCEPT_ALL' | 'SAVE_PREFERENCES') => {
    const stored = {
      policyVersion: COOKIE_POLICY_VERSION,
      categories: customCategories,
      decidedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: stored }));

    try {
      await fetch('/api/privacy/cookie-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anonymousId: getAnonymousId(),
          categories: customCategories,
          decision,
          policyVersion: COOKIE_POLICY_VERSION,
        }),
      });
    } catch {
      // Falha silenciosa no envio ao backend
    }

    pushToast({
      title: 'Configurações salvas',
      description: 'Suas preferências de cookies foram atualizadas com sucesso.',
      variant: 'success',
    });
  };

  const handleSave = () => {
    savePreferences(categories, 'SAVE_PREFERENCES');
  };

  const handleAcceptAll = () => {
    const allActive: CookieCategories = {
      essential: true,
      analytics: true,
      marketing: true,
      preferences: true,
    };
    setCategories(allActive);
    savePreferences(allActive, 'ACCEPT_ALL');
  };

  return (
    <TooltipProvider delayDuration={150}>
      <article className="relative overflow-hidden bg-white text-[#1d1230]">
        <VerticalGridLines showSidebarLine />
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
            <aside className="lg:sticky lg:top-28 lg:self-start lg:-ml-[35px]">
              <LegalSidebarNav activeHref="/cookies" />
            </aside>

            <div className="lg:-ml-[40px] lg:-mr-[55px]">
              <header className="max-w-3xl mx-auto">
                <Breadcrumb className="mb-6">
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <Link href="/legal">Legal</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Preferências de cookies</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Configurações de cookies</h1>
                <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-700">
                  A Alusa usa cookies e tecnologias similares para aprimorar sua experiência e para fins de publicidade.
                  Analise e gerencie as configurações de cookies abaixo para controlar sua privacidade. Para obter mais
                  informações sobre como utilizamos cookies, consulte a{' '}
                  <Link href="/cookies" className="underline font-semibold text-slate-800 hover:text-slate-955">
                    Política de Cookies da Alusa
                  </Link>
                  .
                </p>
              </header>

              <div className="mt-12 border-t border-slate-200">
                {CATEGORIES_METADATA.map((cat) => {
                  const isChecked = categories[cat.key];
                  const isExpanded = !!expanded[cat.key];

                  return (
                    <section
                      key={cat.key}
                      className="border-b border-slate-200 py-10 sm:py-12"
                    >
                      <div className="max-w-3xl mx-auto">
                        <div className="flex items-start justify-between gap-6">
                          <div className="flex-1 space-y-2">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#2a1744]">
                              {cat.title}
                            </h2>
                            <p className="text-base leading-7 text-slate-600">
                              {cat.description}
                            </p>
                            <button
                              type="button"
                              onClick={() => toggleExpand(cat.key)}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-alusa-purple hover:text-alusa-purple-hover mt-3 transition-colors"
                            >
                              {isExpanded ? (
                                <>
                                  Ocultar cookies <ChevronUp className="h-4 w-4" />
                                </>
                              ) : (
                                <>
                                  Mostrar cookies <ChevronDown className="h-4 w-4" />
                                </>
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 pt-1">
                            {cat.isEssential ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded">
                                  Obrigatória
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" className="text-slate-400 hover:text-slate-600">
                                      <HelpCircle className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Esses cookies são necessários para o funcionamento de nossos sistemas.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-slate-500">
                                  {isChecked ? 'Ativado' : 'Desativado'}
                                </span>
                                <Switch
                                  checked={isChecked}
                                  onCheckedChange={(checked) => handleToggle(cat.key, checked)}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-8 overflow-x-auto border border-slate-100 rounded-lg">
                            <table className="min-w-full border-collapse text-sm">
                              <thead className="bg-[#f8f5ff]">
                                <tr>
                                  <th className="px-4 py-3 text-left font-semibold text-[#2a1744] w-1/3">
                                    Cookie
                                  </th>
                                  <th className="px-4 py-3 text-left font-semibold text-[#2a1744]">
                                    Domínio
                                  </th>
                                  <th className="px-4 py-3 text-left font-semibold text-[#2a1744]">
                                    Tipo
                                  </th>
                                  <th className="px-4 py-3 text-left font-semibold text-[#2a1744]">
                                    Duração
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {cat.cookies.map((cookie) => (
                                  <tr key={cookie.name} className="bg-white hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 align-middle text-slate-800 font-medium">
                                      <div className="flex items-center gap-1.5">
                                        <span>{cookie.name}</span>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button type="button" className="text-slate-400 hover:text-slate-600">
                                              <HelpCircle className="h-3.5 w-3.5" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {cookie.description}
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 align-middle text-slate-600">
                                      {cookie.domain}
                                    </td>
                                    <td className="px-4 py-3 align-middle text-slate-600">
                                      {cookie.type}
                                    </td>
                                    <td className="px-4 py-3 align-middle text-slate-600">
                                      {cookie.duration}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>

              <div className="mt-10 border-b border-slate-200 pb-12 sm:pb-16">
                <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-3 sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAcceptAll}
                    className="h-11 border-slate-200 bg-white text-alusa-purple hover:bg-alusa-purple-tint hover:text-alusa-purple-hover font-semibold transition-colors order-2 sm:order-1"
                  >
                    Aceitar todos os cookies
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    className="h-11 bg-alusa-purple text-white hover:bg-alusa-purple-hover font-semibold transition-colors order-1 sm:order-2"
                  >
                    Salvar configurações
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </TooltipProvider>
  );
}
