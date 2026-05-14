import React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100svh] min-h-dvh w-full bg-white text-gray-900 antialiased">
      {children}
    </main>
  );
}