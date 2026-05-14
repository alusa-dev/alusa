'use client';

import { useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { X } from '@/components/icons/icons';
import { UserMenuPanel } from '@/components/layout/UserMenu';
import { useUserStore, type UserState, type User } from '@/lib/stores/user-store';

type MobileUserMenuDrawerProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
};

export function MobileUserMenuDrawer({ open, onOpenChange }: MobileUserMenuDrawerProps) {
  const { data: session } = useSession();
  const storeUser = useUserStore((s: UserState) => s.user);
  const user = (storeUser ?? (session?.user as User) ?? null) as User | null;
  const name = (user?.name || 'Usuário').trim();
  const email = user?.email || '';
  const foto = user?.foto ?? null;
  const avatarUrl = storeUser?.foto ?? foto ?? null;

  const initials = useMemo(() => {
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || 'U';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
    return (first + last).toUpperCase();
  }, [name]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-label="Fechar menu da conta"
      />

      <aside
        className="absolute right-0 top-0 flex h-full w-[min(88vw,320px)] flex-col border-l border-gray-100 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Conta e preferências"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/5">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="" fill sizes="44px" className="object-cover" />
              ) : (
                <span className="text-[12px] font-semibold text-[#2A004A]">
                  {storeUser?.name ? `${storeUser.name[0]}` : initials}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
              {email ? <p className="truncate text-xs text-gray-500">{email}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-900"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <UserMenuPanel onClose={() => onOpenChange(false)} />
        </div>
      </aside>
    </div>
  );
}
