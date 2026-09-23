'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';

export default function SignOutForInviteButton({ token }: { token: string }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const callbackUrl = `/auth/register?token=${encodeURIComponent(token)}`;

  return (
    <button
      type="button"
      disabled={isSigningOut}
      onClick={() => {
        setIsSigningOut(true);
        void signOut({ callbackUrl }).catch(() => setIsSigningOut(false));
      }}
      className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
    >
      {isSigningOut ? 'Encerrando sessão…' : 'Sair e continuar com este convite'}
    </button>
  );
}
