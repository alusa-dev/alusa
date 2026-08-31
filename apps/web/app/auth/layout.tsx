import React from 'react';

// Fluxos de autenticação podem carregar sessão, callback e tokens pela URL.
// Mantê-los dinâmicos evita que o shell seja servido como HTML compartilhado.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100svh] min-h-dvh w-full bg-white text-gray-900 antialiased">
      {children}
    </main>
  );
}
