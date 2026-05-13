'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useSession } from 'next-auth/react';
// Heroicons
import {
  ChevronDownIcon,
  QuestionMarkCircleIcon,
  ArrowRightStartOnRectangleIcon,
  UserCircleIcon,
  SunIcon,
  MoonIcon,
} from '@/components/icons/icons';
import { useTheme } from '@/components/theme/ThemeProvider';
import { useUserStore, type UserState, type User } from '@/lib/stores/user-store';

type Props = {
  name: string;
  email: string;
  initials: string;
  foto?: string | null;
};

export default function UserMenu({ name, email, initials, foto }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { isDark, toggleTheme } = useTheme();
  const { data: session } = useSession();
  const storeUser = useUserStore((state: UserState) => state.user);
  const updateUser = useUserStore((state: UserState) => state.updateUser);
  const roleFromSession = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = typeof roleFromSession === 'string' && roleFromSession.toUpperCase() === 'ADMIN';
  // myAccountLocked removido - wizard é o único onboarding
  const myAccountLocked = false;
  // Avatar derives from store (preferido) e depois prop (fallback)
  const avatarUrl = storeUser?.foto ?? foto ?? null;

  // Atualiza avatar ao receber evento global de atualização do usuário
  useEffect(() => {
    function onUserUpdated(e: Event) {
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      if (detail) updateUser(detail as unknown as Partial<User>);
    }
    window.addEventListener('user:updated', onUserUpdated as EventListener);
    return () => window.removeEventListener('user:updated', onUserUpdated as EventListener);
  }, [updateUser]);

  // (sem estado local) — avatar é derivado da store/propriedade

  // Fechar ao clicar fora / ESC
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(t) &&
        btnRef.current &&
        !btnRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      {/* Pílula do usuário (abre/fecha menu) */}
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-3 rounded-full pl-1 pr-3 py-1 ring-1 ring-black/5 transition-colors hover:bg-black/5"
      >
        <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 bg-white">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill sizes="40px" className="object-cover" />
          ) : (
            <span className="text-[12px] font-semibold text-[#2A004A]">
              {storeUser?.name ? `${storeUser.name[0]}` : initials}
            </span>
          )}
        </span>
        <span className="hidden sm:flex flex-col items-start text-left">
          <span className="text-[14px] font-medium leading-tight text-black">{name}</span>
          <span className="text-[12px] leading-tight text-gray-500">{email}</span>
        </span>
        <ChevronDownIcon className="ml-1 h-4 w-4 opacity-70 group-hover:opacity-100" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Menu do usuário"
          className="absolute right-0 top-[56px] w-[320px] rounded-[20px] bg-white ring-1 ring-black/5 z-overlay"
          style={{
            boxShadow:
              'rgba(14, 63, 126, 0.06) 0px 0px 0px 1px, rgba(42, 51, 70, 0.03) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 2px 2px -1px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.03) 0px 5px 5px -2.5px, rgba(42, 51, 70, 0.03) 0px 10px 10px -5px, rgba(42, 51, 70, 0.03) 0px 24px 24px -8px',
          }}
        >
          <nav className="p-2">
            {/* Minha conta */}
            {myAccountLocked ? (
              <MenuDisabledItem icon={<UserCircleIcon className="h-5 w-5" />} title="Finalize o cadastro financeiro para acessar Minha conta.">
                Minha conta
              </MenuDisabledItem>
            ) : (
              <MenuLink
                href="/conta"
                icon={<UserCircleIcon className="h-5 w-5" />}
                onClick={() => setOpen(false)}
              >
                Minha conta
              </MenuLink>
            )}

            {/* Ajuda */}
            <MenuLink
              href="/ajuda"
              icon={<QuestionMarkCircleIcon className="h-5 w-5" />}
              onClick={() => setOpen(false)}
            >
              Ajuda
            </MenuLink>

            <Divider />

            {/* Tema — Toggle com Sol/Lua (funcional) */}
            <ThemeMenuItem isOn={isDark} onToggle={toggleTheme} />

            <Divider />

            {/* Encerrar sessão */}
            <MenuButton
              icon={<ArrowRightStartOnRectangleIcon className="h-5 w-5" />}
              onClick={() => {
                setOpen(false);
                // Usa fluxo padrão com callbackUrl explícito para minimizar chamadas extras a /api/auth/session
                void signOut({ callbackUrl: '/' });
              }}
            >
              Encerrar sessão
            </MenuButton>
          </nav>
        </div>
      )}
    </div>
  );
}

/* ----------------------- Subcomponentes ----------------------- */

function Divider() {
  return <div className="mx-2 my-2 h-px bg-black/5" />;
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-[15px] font-medium text-black transition-colors hover:bg-black/5"
    >
      <span className="text-black/80">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}

function MenuDisabledItem({
  icon,
  children,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div
      role="menuitem"
      aria-disabled="true"
      title={title}
      className="flex w-full cursor-not-allowed items-center gap-3 rounded-[12px] px-3 py-2 text-[15px] font-medium text-black/60"
    >
      <span className="text-black/50">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function MenuButton({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[15px] font-medium text-black transition-colors hover:bg-black/5"
    >
      <span className="text-black/80">{icon}</span>
      <span>{children}</span>
    </button>
  );
}

/**
 * Item "Tema" com switch (UI somente).
 * Usa Sun/Moon do Heroicons.
 */
function ThemeMenuItem({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  return (
    <div
      role="menuitem"
      className="flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-[15px] font-medium text-black transition-colors hover:bg-black/5"
      onClick={onToggle}
    >
      <span className="flex items-center gap-3">
        <span className="text-black/80">
          {isOn ? (
            <MoonIcon className="h-5 w-5 transition-transform duration-200" />
          ) : (
            <SunIcon className="h-5 w-5 transition-transform duration-200" />
          )}
        </span>
        <span>Tema</span>
      </span>

      {/* Switch pill */}
      <span
        aria-hidden="true"
        className={[
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          isOn ? 'bg-[#A94DFF]' : 'bg-black/10',
        ].join(' ')}
      >
        <span
          className={[
            'absolute inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform duration-200',
            isOn ? 'translate-x-[22px]' : 'translate-x-[2px]',
          ].join(' ')}
        >
          {isOn ? (
            <MoonIcon className="h-3.5 w-3.5 text-[#6B21A8]" />
          ) : (
            <SunIcon className="h-3.5 w-3.5 text-[#A162F7]" />
          )}
        </span>
      </span>
    </div>
  );
}
