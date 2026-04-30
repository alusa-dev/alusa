'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { ChevronDown, ChevronLeft, Logout, Search, UserCircle } from '@/components/icons/icons';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

import { GLOBAL_ADMIN_LAYOUT } from './layout-tokens';
import { globalAdminNavigation } from './navigation';

export function GlobalAdminShell({
  username,
  children,
}: {
  username: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!menuOpen) return;
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    await fetch('/api/global-admin/auth/logout', { method: 'POST' });
    setMenuOpen(false);
    router.replace('/developer/login');
    router.refresh();
  }

  return (
    <div className="relative h-screen w-full overflow-hidden app-surface-bg">
      <aside
        aria-label="Menu da central global"
        className="fixed inset-y-0 left-0 z-40 flex w-[262px] flex-col bg-[#F7F5F8]"
      >
        <div className="relative px-4 pt-7 pb-8">
          <div className="flex items-center justify-center">
            <Link href="/developer/dashboard" aria-label="Alusa">
              <img
                src="/brand/logo-sidebar.svg"
                alt="Alusa"
                width={132}
                height={40}
                className="h-10 w-auto select-none"
                draggable={false}
              />
            </Link>
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 rounded-xl bg-[#EEE6F4] p-2 text-[#2b2634]">
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 pb-6">
          <ul className="flex flex-col gap-2">
            {globalAdminNavigation.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex h-[52px] items-center gap-3 rounded-[10px] px-4 text-[16px] transition',
                      active
                        ? 'bg-[#EEE6F4] font-semibold text-[#2b2634]'
                        : 'font-medium text-[#2b2634] hover:bg-white',
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{item.shortLabel}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <main
        className="with-sidebar h-full overflow-hidden"
        style={{ ['--sidebar-gap' as string]: `${GLOBAL_ADMIN_LAYOUT.contentGapPx}px` } as Record<string, string>}
      >
        <div
          className="h-full overflow-visible"
          style={{
            paddingTop: GLOBAL_ADMIN_LAYOUT.outerPaddingTopPx,
            paddingRight: GLOBAL_ADMIN_LAYOUT.outerPaddingRightPx,
            paddingBottom: GLOBAL_ADMIN_LAYOUT.outerPaddingBottomPx,
            paddingLeft: GLOBAL_ADMIN_LAYOUT.outerPaddingLeftPx,
          }}
        >
          <div
            className="flex h-full w-full flex-col overflow-hidden bg-white"
            style={{
              height: `calc(100vh - ${GLOBAL_ADMIN_LAYOUT.outerPaddingTopPx + GLOBAL_ADMIN_LAYOUT.outerPaddingBottomPx}px)`,
              borderRadius: GLOBAL_ADMIN_LAYOUT.cardRadiusPx,
              padding: GLOBAL_ADMIN_LAYOUT.cardPaddingPx,
              boxShadow: GLOBAL_ADMIN_LAYOUT.cardShadow,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <header className="flex items-center justify-between">
              <form action="/developer/search" className="relative w-full max-w-[460px]">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-70">
                  <Search className="h-4 w-4" />
                </div>
                <Input
                  name="q"
                  type="search"
                  placeholder="Buscar pessoa, conta, cobrança ou webhook"
                  className="h-11 rounded-full border-0 bg-white pl-9 pr-4 text-[14px] ring-1 ring-black/5 placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-[#A94DFF]"
                />
              </form>

              <div className="flex items-center gap-4 pl-6">
                <div className="relative">
                  <button
                    ref={menuButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((current) => !current)}
                    className="group flex items-center gap-3 rounded-full py-1 pl-1 pr-3 ring-1 ring-black/5 transition-colors hover:bg-black/5"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white ring-1 ring-black/5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEE6F4] text-[#3E1F63]">
                        <UserCircle className="h-5 w-5" />
                      </span>
                    </span>
                    <span className="hidden text-left sm:flex sm:flex-col">
                      <span className="text-[14px] font-medium leading-tight text-black">{username}</span>
                      <span className="text-[12px] leading-tight text-gray-500">Admin global</span>
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-70 group-hover:opacity-100" />
                  </button>

                  {menuOpen ? (
                    <div
                      ref={menuRef}
                      role="menu"
                      aria-label="Menu do admin global"
                      className="absolute right-0 top-[56px] z-[80] w-[260px] rounded-[20px] bg-white ring-1 ring-black/5"
                      style={{ boxShadow: GLOBAL_ADMIN_LAYOUT.cardShadow }}
                    >
                      <div className="border-b border-black/5 px-4 py-4">
                        <p className="text-[14px] font-semibold text-slate-950">{username}</p>
                        <p className="mt-1 text-[12px] text-slate-500">Acesso global restrito da Alusa.</p>
                      </div>
                      <div className="p-2">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleLogout()}
                          className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[15px] font-medium text-black transition-colors hover:bg-black/5"
                        >
                          <Logout className="h-5 w-5 text-black/80" />
                          <span>Encerrar sessão</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="relative mt-6 flex-1 overflow-y-auto pr-2">
              <div className="space-y-5 pb-8">{children}</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
