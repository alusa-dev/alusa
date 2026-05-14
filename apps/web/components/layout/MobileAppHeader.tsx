'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Menu } from '@/components/icons/icons';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { MobileUserMenuDrawer } from '@/components/layout/MobileUserMenuDrawer';
import { useTheme } from '@/components/theme/ThemeProvider';
import { useUserStore, type UserState, type User } from '@/lib/stores/user-store';

export function MobileAppHeader() {
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { isDark } = useTheme();
  const { data: session } = useSession();
  const storeUser = useUserStore((s: UserState) => s.user);
  const user = (storeUser ?? (session?.user as User) ?? null) as User | null;
  const name = (user?.name || 'Usuário').trim();
  const foto = user?.foto ?? null;
  const avatarUrl = storeUser?.foto ?? foto ?? null;

  const initials = useMemo(() => {
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || 'U';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
    return (first + last).toUpperCase();
  }, [name]);

  const role =
    typeof session?.user === 'object' && session?.user && 'role' in session.user
      ? (session.user as { role?: string }).role
      : undefined;
  const isPortalUser = role === 'ALUNO' || role === 'RESPONSAVEL';
  const homeHref = isPortalUser ? '/portal' : '/dashboard';

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 lg:hidden">
        <Link href={homeHref} prefetch={false} className="inline-flex min-w-0">
          <img
            src={isDark ? '/brand/logo-sidebar-dark.svg' : '/brand/logo-sidebar.svg'}
            alt="Alusa"
            width={108}
            height={32}
            className="h-8 w-auto max-w-[40vw] select-none"
            draggable={false}
          />
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setUserMenuOpen(true)}
            className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/5"
            aria-label="Menu da conta"
            aria-haspopup="dialog"
            aria-expanded={userMenuOpen}
          >
            {avatarUrl ? (
              <Image src={avatarUrl} alt="" fill sizes="40px" className="object-cover" />
            ) : (
              <span className="text-[12px] font-semibold text-[#2A004A]">
                {storeUser?.name ? `${storeUser.name[0]}` : initials}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-900 ring-1 ring-black/5"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <MobileSidebar open={navOpen} onOpenChange={setNavOpen} />
      <MobileUserMenuDrawer open={userMenuOpen} onOpenChange={setUserMenuOpen} />
    </>
  );
}
